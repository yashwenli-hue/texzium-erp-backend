import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateProformaInvoiceDto } from './dto/create-proforma-invoice.dto';
import { ApproveProformaInvoiceDto } from './dto/approve-proforma-invoice.dto';
import { CancelProformaInvoiceDto } from './dto/cancel-proforma-invoice.dto';
import {
  QUOTATION_STATUS,
  lockQuotation,
} from '../quotations/quotation-lifecycle';
import {
  PROFORMA_EVENT_ACTION,
  PROFORMA_STATUS,
  assertNoLiveSalesOrder,
  conflictActiveProformaExists,
  conflictCannotApprove,
  conflictCannotCancel,
  conflictExpired,
  conflictQuotationNotApproved,
  isProformaExpired,
  isProformaTransitionAllowed,
  lockProforma,
  recordProformaEvent,
  requireProforma,
  requireProformaActor,
  setProformaStatusIfStill,
  totalsMatch,
} from './proforma-lifecycle';
import { requireActiveCustomerShared } from '../customer-master/customer-lifecycle';
import { copyLineValues } from '../quotations/quotation-lines';
import {
  DOCUMENT_NUMBER_TYPE,
  allocateDocumentNumber,
} from '../../adminos/document-number-series/document-numbering';

import { loadDocumentIssuer } from '../../adminos/document-profile/document-identity';
import type { ProformaDocumentData } from './proforma-document';
import { PROFORMA_NOT_FOUND_MESSAGE } from './proforma-lifecycle';
import {
  ALL_RECORDS,
  RecordScope,
  proformaWhere,
} from '../record-scope/record-scope';

export const PROFORMA_LINES_ORDER = { lineNumber: 'asc' } as const;

@Injectable()
export class ProformaInvoicesService {
  constructor(private prisma: PrismaService) {}

  // Creates a PENDING Proforma Invoice from an APPROVED Quotation.
  //
  // The total is the Quotation's: the client's number is never stored, and a
  // different one is refused. A Quotation can have only one active (not
  // cancelled) Proforma. The Quotation row is locked for the whole
  // transaction, so two simultaneous requests cannot both pass that check and a
  // revision of the Quotation cannot slip in between the status check and the
  // insert: either the Proforma exists first (and the revision is refused) or
  // the revision goes first (and this sees the Quotation is no longer
  // APPROVED).
  async create(data: CreateProformaInvoiceDto, actorId: string | undefined) {
    const actor = await requireProformaActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const quotationStatus = await lockQuotation(tx, data.quotationId);

      if (quotationStatus !== QUOTATION_STATUS.APPROVED) {
        throw conflictQuotationNotApproved(quotationStatus);
      }

      const quotation = await tx.quotation.findUniqueOrThrow({
        where: { id: data.quotationId },
        select: {
          totalAmount: true,
          sellerGstId: true,
          opportunity: { select: { customerId: true } },
          lines: { orderBy: PROFORMA_LINES_ORDER },
        },
      });

      // A customer-linked quotation gets no new Proforma once its customer is
      // inactive (the customer stays active until this commits). An unlinked,
      // legacy one is unaffected.
      const customerId = quotation.opportunity?.customerId;

      if (customerId) {
        await requireActiveCustomerShared(
          tx,
          customerId,
          'This customer is inactive. Reactivate it before creating a Proforma Invoice for it.',
        );
      }

      if (
        data.totalAmount !== undefined &&
        !totalsMatch(data.totalAmount, quotation.totalAmount)
      ) {
        throw new BadRequestException(
          `The total must match the approved Quotation (${quotation.totalAmount}).`,
        );
      }

      const active = await tx.proformaInvoice.count({
        where: {
          quotationId: data.quotationId,
          customerStatus: { not: PROFORMA_STATUS.CANCELLED },
        },
      });

      if (active > 0) {
        throw conflictActiveProformaExists();
      }

      const now = new Date();
      const issueDate = new Date(data.issueDate);

      // The next number of the seller registration's Proforma series. A legacy
      // quotation without a seller registration gives an unnumbered Proforma,
      // as before: no series is guessed for it.
      const seller = quotation.sellerGstId
        ? await tx.companyGSTRegistration.findUnique({
            where: { id: quotation.sellerGstId },
            select: { id: true, stateCode: true },
          })
        : null;
      const proformaNumber = seller
        ? (
            await allocateDocumentNumber(
              tx,
              DOCUMENT_NUMBER_TYPE.PROFORMA_INVOICE,
              {
                kind: 'registration',
                gstRegistrationId: seller.id,
                stateCode: seller.stateCode,
              },
              issueDate,
            )
          ).number
        : null;

      const proforma = await tx.proformaInvoice.create({
        data: {
          quotationId: data.quotationId,
          proformaNumber,
          issueDate,
          totalAmount: quotation.totalAmount,
          customerStatus: PROFORMA_STATUS.PENDING,
          validityDate: data.validityDate ? new Date(data.validityDate) : null,
          remarks: data.remarks || undefined,
        },
      });

      // The Quotation's lines as they are now (it is APPROVED, and cannot be
      // revised while this Proforma is active). None if it has none.
      if (quotation.lines.length > 0) {
        await tx.proformaInvoiceLine.createMany({
          data: quotation.lines.map((line) => ({
            proformaInvoiceId: proforma.id,
            sourceQuotationLineId: line.id,
            ...copyLineValues(line),
          })),
        });
      }

      await recordProformaEvent(tx, {
        proformaInvoiceId: proforma.id,
        action: PROFORMA_EVENT_ACTION.PROFORMA_CREATED,
        toStatus: PROFORMA_STATUS.PENDING,
        actorId: actor.id,
        occurredAt: now,
      });

      return proforma;
    });
  }

  // Everything the Proforma document prints, read as stored.
  async documentData(id: string): Promise<ProformaDocumentData> {
    const p = await this.prisma.proformaInvoice.findUnique({
      where: { id },
      include: {
        lines: { orderBy: PROFORMA_LINES_ORDER },
        quotation: {
          include: { opportunity: { select: { customerId: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException(PROFORMA_NOT_FOUND_MESSAGE);

    const q = p.quotation;
    const customer = q.opportunity?.customerId
      ? await this.prisma.customer.findUnique({
          where: { id: q.opportunity.customerId },
          select: { id: true, customerName: true, customerCode: true },
        })
      : null;
    const buyer = q.buyerGstId
      ? await this.prisma.customerGSTRegistration.findUnique({
          where: { id: q.buyerGstId },
        })
      : null;

    return {
      proforma: {
        ...p,
        isExpired: isProformaExpired(p.validityDate, new Date()),
      },
      quotation: q,
      lines: p.lines,
      customer,
      buyer:
        buyer && (!customer || buyer.customerId === customer.id) ? buyer : null,
      issuer: await loadDocumentIssuer(this.prisma, q.sellerGstId),
      generatedAt: new Date(),
    };
  }

  // Every Proforma with its Quotation. `isExpired` is derived from the
  // validity date by the same rule approval and Sales Order creation use.
  async findAll(scope: RecordScope = ALL_RECORDS) {
    const now = new Date();
    const proformas = await this.prisma.proformaInvoice.findMany({
      where: proformaWhere(scope),
      include: {
        quotation: true,
        lines: { orderBy: PROFORMA_LINES_ORDER },
      },
    });

    return proformas.map((p) => ({
      ...p,
      isExpired: isProformaExpired(p.validityDate, now),
    }));
  }

  // Lifecycle history of one Proforma Invoice, newest first.
  async findEvents(id: string) {
    await requireProforma(this.prisma, id);

    return this.prisma.proformaEvent.findMany({
      where: { proformaInvoiceId: id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        // Only id and name leave the API as an actor.
        actor: { select: { id: true, fullName: true } },
      },
    });
  }

  // Approves a PENDING Proforma that has not expired. An approved Proforma
  // cannot be approved again.
  async approve(
    id: string,
    actorId: string | undefined,
    data: ApproveProformaInvoiceDto,
  ) {
    const actor = await requireProformaActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const to = PROFORMA_STATUS.APPROVED;

      const from = await lockProforma(tx, id);

      // Taken once the lock is held, so events of racing requests are
      // timestamped in the order they actually happened.
      const now = new Date();

      if (!isProformaTransitionAllowed(from, to)) {
        throw conflictCannotApprove(from);
      }

      const current = await tx.proformaInvoice.findUniqueOrThrow({
        where: { id },
      });

      if (
        current.validityDate &&
        isProformaExpired(current.validityDate, now)
      ) {
        throw conflictExpired(current.validityDate, 'approved');
      }

      const moved = await setProformaStatusIfStill(tx, id, from, to);

      if (!moved) {
        const latest = await tx.proformaInvoice.findUniqueOrThrow({
          where: { id },
        });
        throw conflictCannotApprove(latest.customerStatus);
      }

      await recordProformaEvent(tx, {
        proformaInvoiceId: id,
        action: PROFORMA_EVENT_ACTION.PROFORMA_APPROVED,
        fromStatus: from,
        toStatus: to,
        remarks: data.remarks || undefined,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.proformaInvoice.findUniqueOrThrow({ where: { id } });
    });
  }

  // Cancels a PENDING or APPROVED Proforma for good, with a mandatory reason,
  // while no Sales Order that is not cancelled references it. The Proforma row
  // is locked for the whole transaction (Sales Order creation takes the same
  // lock), so that check and the status change are one decision.
  async cancel(
    id: string,
    actorId: string | undefined,
    data: CancelProformaInvoiceDto,
  ) {
    const actor = await requireProformaActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const to = PROFORMA_STATUS.CANCELLED;

      const from = await lockProforma(tx, id);

      const now = new Date();

      if (!isProformaTransitionAllowed(from, to)) {
        throw conflictCannotCancel(from);
      }

      await assertNoLiveSalesOrder(tx, id);

      const moved = await setProformaStatusIfStill(tx, id, from, to);

      if (!moved) {
        const latest = await tx.proformaInvoice.findUniqueOrThrow({
          where: { id },
        });
        throw conflictCannotCancel(latest.customerStatus);
      }

      await recordProformaEvent(tx, {
        proformaInvoiceId: id,
        action: PROFORMA_EVENT_ACTION.PROFORMA_CANCELLED,
        fromStatus: from,
        toStatus: to,
        remarks: data.reason,
        actorId: actor.id,
        occurredAt: now,
      });

      return tx.proformaInvoice.findUniqueOrThrow({ where: { id } });
    });
  }
}
