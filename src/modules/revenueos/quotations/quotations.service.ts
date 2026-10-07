import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { requireActiveCustomerShared } from '../customer-master/customer-lifecycle';
import {
  conflictOpportunityNotLinked,
  lockOpportunityShared,
} from '../opportunities/opportunity-customer';
import {
  badRequestBuyerGstNotCustomers,
  conflictRegistrationInactive,
} from '../customer-gst/customer-gst-lifecycle';

@Injectable()
export class QuotationsService {
  constructor(private prisma: PrismaService) {}

  // Creates a DRAFT quotation for an opportunity that has a customer.
  //
  // The customer comes from the opportunity (never from the request), so the
  // buyer GST registration has to be one of that customer's, and active; the
  // customer has to be active too. Everything is read and decided in one
  // transaction that holds the opportunity (shared) and then the customer
  // (shared): the customer can no longer be linked, changed or unlinked, be
  // deactivated, or have its registrations changed until this commits. An
  // opportunity without a customer is a legacy one: link a customer to it
  // first.
  async create(data: CreateQuotationDto, actorId: string | undefined) {
    const actor = await requireQuotationActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      // 1. Opportunity, and its customer
      const { customerId } = await lockOpportunityShared(
        tx,
        data.opportunityId,
      );

      if (!customerId) {
        throw conflictOpportunityNotLinked();
      }

      await requireActiveCustomerShared(
        tx,
        customerId,
        'This customer is inactive. Reactivate it before creating a quotation for it.',
      );

      // 2. Inventory item
      const inventory = await tx.inventoryItem.findUnique({
        where: { id: data.inventoryItemId },
        include: {
          hsnMaster: true,
        },
      });

      if (!inventory) {
        throw new NotFoundException('Inventory item not found');
      }

      if (!inventory.hsnMaster) {
        throw new BadRequestException('HSN not mapped to inventory item');
      }

      // 3. Seller GST
      const sellerGst = await tx.companyGSTRegistration.findUnique({
        where: { id: data.sellerGstId },
      });

      if (!sellerGst) {
        throw new NotFoundException('Seller GST not found');
      }

      if (!sellerGst.isActive) {
        throw conflictRegistrationInactive('seller');
      }

      // 4. Buyer GST: the customer's own, and active
      const buyerGst = await tx.customerGSTRegistration.findUnique({
        where: { id: data.buyerGstId },
      });

      if (!buyerGst) {
        throw new NotFoundException('Buyer GST not found');
      }

      if (buyerGst.customerId !== customerId) {
        throw badRequestBuyerGstNotCustomers();
      }

      if (!buyerGst.isActive) {
        throw conflictRegistrationInactive('buyer');
      }

      // 5. Tax type
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
}
