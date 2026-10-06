import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ApproveQuotationDto } from './dto/approve-quotation.dto';
import { ReviseQuotationDto } from './dto/revise-quotation.dto';
import { RejectQuotationDto } from './dto/reject-quotation.dto';
import {
  QUOTATION_EVENT_ACTION,
  QUOTATION_STATUS,
  assertNoActiveDownstreamDocuments,
  computeQuotationAmounts,
  conflictCannotApprove,
  conflictCannotReject,
  conflictCannotRevise,
  conflictInconsistentTaxBreakdown,
  hasConsistentTaxBreakdown,
  isQuotationTransitionAllowed,
  lockQuotation,
  recordQuotationEvent,
  requireQuotation,
  requireQuotationActor,
  setQuotationStatusIfStill,
} from './quotation-lifecycle';

@Injectable()
export class QuotationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateQuotationDto, actorId: string | undefined) {
    const actor = await requireQuotationActor(this.prisma, actorId);

    // 1. Validate Opportunity
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: data.opportunityId },
    });

    if (!opportunity) {
      throw new Error('Opportunity not found');
    }

    // 2. Validate Inventory Item
    const inventory = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      include: {
        hsnMaster: true,
      },
    });

    if (!inventory) {
      throw new Error('Inventory item not found');
    }

    if (!inventory.hsnMaster) {
      throw new Error('HSN not mapped to inventory item');
    }

    // 3. Validate Seller GST
    const sellerGst = await this.prisma.companyGSTRegistration.findUnique({
      where: { id: data.sellerGstId },
    });

    if (!sellerGst) {
      throw new Error('Seller GST not found');
    }

    // 4. Validate Buyer GST
    const buyerGst = await this.prisma.customerGSTRegistration.findUnique({
      where: { id: data.buyerGstId },
    });

    if (!buyerGst) {
      throw new Error('Buyer GST not found');
    }

    // 5. Tax Type Logic
    let taxType = '';
    let gstAmount = 0;

    const taxableAmount = data.quantity * data.unitPrice;
    const gstRate = inventory.hsnMaster.gstRate;

    if (sellerGst.stateCode === buyerGst.stateCode) {
      taxType = 'CGST_SGST';
      gstAmount = (taxableAmount * gstRate) / 100;
    } else {
      taxType = 'IGST';
      gstAmount = (taxableAmount * gstRate) / 100;
    }

    const totalAmount = taxableAmount + gstAmount;

    // 6. Create Quotation, with the event that starts its history
    return this.prisma.$transaction(async (tx) => {
      const quotation = await tx.quotation.create({
        data: {
          opportunityId: data.opportunityId,
          quoteDate: new Date(data.quoteDate),

          sellerGstId: data.sellerGstId,
          buyerGstId: data.buyerGstId,
          placeOfSupply: buyerGst.stateName,
          taxType: taxType,

          taxableAmount: taxableAmount,
          gstPercent: gstRate,
          gstAmount: gstAmount,
          totalAmount: totalAmount,

          status: QUOTATION_STATUS.DRAFT,
        },
      });

      await recordQuotationEvent(tx, {
        quotationId: quotation.id,
        action: QUOTATION_EVENT_ACTION.QUOTATION_CREATED,
        toStatus: QUOTATION_STATUS.DRAFT,
        newTaxableAmount: quotation.taxableAmount,
        newTotalAmount: quotation.totalAmount,
        actorId: actor.id,
        occurredAt: quotation.createdAt,
      });

      return quotation;
    });
  }

  async findAll() {
    return this.prisma.quotation.findMany({
      include: {
        opportunity: true,
      },
    });
  }

  // Lifecycle history of one Quotation, newest first.
  async findEvents(id: string) {
    await requireQuotation(this.prisma, id);

    return this.prisma.quotationEvent.findMany({
      where: { quotationId: id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        // Only id and name leave the API as an actor.
        actor: { select: { id: true, fullName: true } },
      },
    });
  }

  // Revises the taxable amount. GST comes from the percentage the quotation
  // already carries and the total is their sum; the request cannot supply
  // either. The quotation goes (back) to REVISED and needs approval again. An
  // APPROVED quotation can be revised only while no Proforma Invoice is active
  // against it and no Sales Order that is not cancelled was created from it.
  // The row is locked for the whole transaction, so that check and the status
  // change are one decision.
  async revise(
    id: string,
    actorId: string | undefined,
    data: ReviseQuotationDto,
  ) {
    const actor = await requireQuotationActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const to = QUOTATION_STATUS.REVISED;

      const from = await lockQuotation(tx, id);

      // Taken once the lock is held, so events of racing requests are
      // timestamped in the order they actually happened.
      const now = new Date();

      if (!isQuotationTransitionAllowed(from, to)) {
        throw conflictCannotRevise(from);
      }

      const current = await tx.quotation.findUniqueOrThrow({ where: { id } });

      if (!hasConsistentTaxBreakdown(current)) {
        throw conflictInconsistentTaxBreakdown('revised');
      }

      if (from === QUOTATION_STATUS.APPROVED) {
        await assertNoActiveDownstreamDocuments(tx, id);
      }

      const amounts = computeQuotationAmounts(
        data.taxableAmount,
        current.gstPercent,
      );

      const moved = await setQuotationStatusIfStill(tx, id, from, to, amounts);

      if (!moved) {
        const latest = await tx.quotation.findUniqueOrThrow({ where: { id } });
        throw conflictCannotRevise(latest.status);
      }

      await recordQuotationEvent(tx, {
        quotationId: id,
        action: QUOTATION_EVENT_ACTION.QUOTATION_REVISED,
        fromStatus: from,
        toStatus: to,
        remarks: data.remarks || undefined,
        previousTaxableAmount: current.taxableAmount,
        newTaxableAmount: amounts.taxableAmount,
        previousTotalAmount: current.totalAmount,
        newTotalAmount: amounts.totalAmount,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.quotation.findUniqueOrThrow({ where: { id } });
    });
  }

  // Approves a DRAFT or REVISED quotation whose stored amounts add up. An
  // approved quotation cannot be approved again.
  async approve(
    id: string,
    actorId: string | undefined,
    data: ApproveQuotationDto,
  ) {
    const actor = await requireQuotationActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const to = QUOTATION_STATUS.APPROVED;

      const from = await lockQuotation(tx, id);

      // Taken once the lock is held, so events of racing requests are
      // timestamped in the order they actually happened.
      const now = new Date();

      if (!isQuotationTransitionAllowed(from, to)) {
        throw conflictCannotApprove(from);
      }

      const current = await tx.quotation.findUniqueOrThrow({ where: { id } });

      if (!hasConsistentTaxBreakdown(current)) {
        throw conflictInconsistentTaxBreakdown('approved');
      }

      const moved = await setQuotationStatusIfStill(tx, id, from, to);

      if (!moved) {
        const latest = await tx.quotation.findUniqueOrThrow({ where: { id } });
        throw conflictCannotApprove(latest.status);
      }

      await recordQuotationEvent(tx, {
        quotationId: id,
        action: QUOTATION_EVENT_ACTION.QUOTATION_APPROVED,
        fromStatus: from,
        toStatus: to,
        remarks: data.remarks || undefined,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.quotation.findUniqueOrThrow({ where: { id } });
    });
  }

  // Rejects a DRAFT or REVISED quotation for good. The reason is mandatory.
  async reject(
    id: string,
    actorId: string | undefined,
    data: RejectQuotationDto,
  ) {
    const actor = await requireQuotationActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const to = QUOTATION_STATUS.REJECTED;

      const from = await lockQuotation(tx, id);

      // Taken once the lock is held, so events of racing requests are
      // timestamped in the order they actually happened.
      const now = new Date();

      if (!isQuotationTransitionAllowed(from, to)) {
        throw conflictCannotReject(from);
      }

      const moved = await setQuotationStatusIfStill(tx, id, from, to);

      if (!moved) {
        const latest = await tx.quotation.findUniqueOrThrow({ where: { id } });
        throw conflictCannotReject(latest.status);
      }

      await recordQuotationEvent(tx, {
        quotationId: id,
        action: QUOTATION_EVENT_ACTION.QUOTATION_REJECTED,
        fromStatus: from,
        toStatus: to,
        remarks: data.reason,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.quotation.findUniqueOrThrow({ where: { id } });
    });
  }

  async convertToSalesOrder(id: string) {
    const quotation =
      await this.prisma.quotation.findUnique({
        where: { id },
      });

    if (!quotation) {
      throw new Error('Quotation not found');
    }

    return this.prisma.salesOrder.create({
      data: {
        quotationId: quotation.id,
        orderDate: new Date(),
        totalAmount: quotation.totalAmount,
        sellerGstId: quotation.sellerGstId,
        buyerGstId: quotation.buyerGstId,
        placeOfSupply: quotation.placeOfSupply,
        taxType: quotation.taxType,
        status: 'OPEN',
      },
    });
  }
}
