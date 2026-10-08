import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../core/database/prisma.service';
import { requireActor } from '../sales-orders/sales-order-lifecycle';
import { CreatePaymentCollectionDto } from './dto/create-payment-collection.dto';
import { ListPaymentCollectionsQueryDto } from './dto/list-payment-collections-query.dto';
import {
  COLLECTIONS_LIST_DEFAULT_LIMIT,
  INVOICE_NOT_FOUND_MESSAGE,
  INVOICE_STATUS_POSTED,
  PAYMENT_COLLECTION_EVENT_ACTION,
  PAYMENT_COLLECTION_NOT_FOUND_MESSAGE,
  PAYMENT_CONFLICT_CODE,
  RECEIVABLE_NOT_FOUND_MESSAGE,
  RECEIVABLE_PAYABLE_STATUSES,
  RECEIVABLE_STATUS,
  formatRupees,
  fromPaise,
  paymentConflict,
  toPaise,
} from './payment-collection-values';

// The people shown on a collection or an event: only these fields ever leave the API.
const ACTOR_SELECT = { id: true, fullName: true } satisfies Prisma.UserSelect;

// The invoice facts a collection is shown with.
const INVOICE_SELECT = {
  id: true,
  invoiceNumber: true,
  invoiceDate: true,
  customerName: true,
  status: true,
  totalAmount: true,
} satisfies Prisma.SalesInvoiceSelect;

const COLLECTION_INCLUDE = {
  recordedBy: { select: ACTOR_SELECT },
  accountsReceivable: {
    select: {
      id: true,
      salesInvoiceId: true,
      dueDate: true,
      outstandingAmount: true,
      paidAmount: true,
      balanceAmount: true,
      paymentStatus: true,
      salesInvoice: { select: INVOICE_SELECT },
    },
  },
} satisfies Prisma.PaymentCollectionInclude;

const EVENT_INCLUDE = {
  actor: { select: ACTOR_SELECT },
} satisfies Prisma.PaymentCollectionEventInclude;

interface LockedReceivable {
  id: string;
  salesInvoiceId: string;
  outstandingAmount: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: string;
}

// Postgres reports a lock that could not be had in time as 55P03 and a
// serialization failure or deadlock as 40001 / 40P01. Prisma surfaces these as
// P2010 (raw query) or P2034 (transaction conflict).
function isBusyError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  if (error.code === 'P2034') return true;

  const sqlState = (error.meta as { code?: string } | undefined)?.code;

  return (
    error.code === 'P2010' &&
    (sqlState === '55P03' || sqlState === '40001' || sqlState === '40P01')
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// Payment collection: the RevenueOS command that records a payment received
// against an invoice, and the reads of what was recorded.
//
// FinanceOS owns the receivable, the customer ledger, the journal, receipts,
// credit notes and write-offs. This command does not change what those mean: it
// moves the receivable's paid and balance figures and appends the matching ledger
// credit exactly as before, and nothing else. It posts no journal entry.
@Injectable()
export class PaymentCollectionsService {
  constructor(private readonly prisma: PrismaService) {}

  // Records one payment. Everything below happens in ONE transaction, so a
  // failure at any step leaves no collection, ledger row, event or receivable
  // change behind.
  //
  // Concurrency: the receivable row is locked FOR UPDATE first, so two payments
  // against the same receivable run one after the other and each is checked
  // against the balance the previous one left. The invoice row is read FOR SHARE
  // second, and the customer's ledger is serialised with an advisory lock last
  // (always in that order). The final receivable update is also conditional on
  // the figures that were read, as a backstop if a writer that does not take the
  // lock got in between.
  async create(data: CreatePaymentCollectionDto, actorId: string | undefined) {
    const actor = await requireActor(this.prisma, actorId);
    const amountPaise = toPaise(data.amountReceived);

    // The DTO already guarantees this; the command does not rely on it, because a
    // payment of less than one paisa would pass every later check.
    if (!Number.isFinite(amountPaise) || amountPaise < 1) {
      throw new BadRequestException(
        'The payment amount must be at least ₹0.01.',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;

          const receivables = await tx.$queryRaw<LockedReceivable[]>`
            SELECT "id", "salesInvoiceId", "outstandingAmount", "paidAmount",
                   "balanceAmount", "paymentStatus"
            FROM "AccountsReceivable"
            WHERE "salesInvoiceId" = ${data.salesInvoiceId}
            FOR UPDATE
          `;

          if (receivables.length === 0) {
            const invoice = await tx.salesInvoice.findUnique({
              where: { id: data.salesInvoiceId },
              select: { id: true },
            });

            throw new NotFoundException(
              invoice
                ? RECEIVABLE_NOT_FOUND_MESSAGE
                : INVOICE_NOT_FOUND_MESSAGE,
            );
          }

          if (receivables.length > 1) {
            throw paymentConflict(
              'This invoice has more than one receivable, so a payment cannot be recorded against it until that is fixed in Finance.',
              PAYMENT_CONFLICT_CODE.AMBIGUOUS_RECEIVABLE,
            );
          }

          const receivable = receivables[0];

          const invoices = await tx.$queryRaw<
            Array<{ status: string; customerName: string | null }>
          >`
            SELECT "status", "customerName"
            FROM "SalesInvoice"
            WHERE "id" = ${data.salesInvoiceId}
            FOR SHARE
          `;

          const invoice = invoices[0];

          if (!invoice) {
            throw new NotFoundException(INVOICE_NOT_FOUND_MESSAGE);
          }

          if (invoice.status !== INVOICE_STATUS_POSTED) {
            throw paymentConflict(
              'A payment can only be recorded against a posted invoice.',
              PAYMENT_CONFLICT_CODE.INVOICE_NOT_POSTED,
            );
          }

          const balanceBefore = toPaise(receivable.balanceAmount);

          if (
            !RECEIVABLE_PAYABLE_STATUSES.includes(receivable.paymentStatus) ||
            balanceBefore <= 0
          ) {
            throw paymentConflict(
              receivable.paymentStatus === RECEIVABLE_STATUS.WRITTEN_OFF
                ? 'This receivable has been written off, so no payment can be recorded against it.'
                : receivable.paymentStatus === RECEIVABLE_STATUS.PAID
                  ? 'This invoice is already fully paid.'
                  : 'Nothing is outstanding on this receivable, so no payment can be recorded against it.',
              PAYMENT_CONFLICT_CODE.RECEIVABLE_CLOSED,
            );
          }

          // The customer ledger is keyed by the invoice's customer name, so a
          // blank name would leave the ledger and the receivable disagreeing.
          const ledgerName = invoice.customerName;

          if (ledgerName === null || ledgerName.trim() === '') {
            throw paymentConflict(
              'This invoice has no customer name, so its payment cannot be posted to the customer ledger. Fix the invoice in Finance first.',
              PAYMENT_CONFLICT_CODE.LEDGER_CUSTOMER_MISSING,
            );
          }

          if (amountPaise > balanceBefore) {
            throw paymentConflict(
              `The payment of ${formatRupees(amountPaise)} is more than the ${formatRupees(balanceBefore)} outstanding on this invoice.`,
              PAYMENT_CONFLICT_CODE.OVERPAYMENT,
            );
          }

          const duplicates = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "PaymentCollection"
            WHERE "accountsReceivableId" = ${receivable.id}
              AND "referenceNumber" IS NOT NULL
              AND lower(btrim("referenceNumber")) = ${data.referenceNo.trim().toLowerCase()}
            LIMIT 1
          `;

          if (duplicates.length > 0) {
            throw paymentConflict(
              `A payment with the reference "${data.referenceNo}" is already recorded for this invoice.`,
              PAYMENT_CONFLICT_CODE.DUPLICATE_REFERENCE,
            );
          }

          // Ledger: one credit entry, with the running balance of this
          // customer's ledger. Serialised per customer name so two payments for
          // the same customer cannot both read the same previous balance.
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtextextended(${`customer-ledger:${ledgerName}`}, 0))
          `;

          const lastLedger = await tx.customerLedger.findFirst({
            where: { customerName: ledgerName },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { balanceAmount: true },
          });

          const ledgerBalance =
            toPaise(lastLedger?.balanceAmount ?? 0) - amountPaise;

          const paymentDate = new Date(data.paymentDate);
          const now = new Date();

          await tx.customerLedger.create({
            data: {
              customerName: ledgerName,
              salesInvoiceId: data.salesInvoiceId,
              debitAmount: 0,
              creditAmount: fromPaise(amountPaise),
              balanceAmount: fromPaise(ledgerBalance),
              entryDate: paymentDate,
              remarks: `Payment received ${data.referenceNo}`,
              // Set after the lock is held, so "latest row" follows lock order.
              createdAt: now,
            },
          });

          const paymentRecord = await tx.paymentCollection.create({
            data: {
              accountsReceivableId: receivable.id,
              paymentDate,
              amount: fromPaise(amountPaise),
              paymentMode: data.paymentMode,
              referenceNumber: data.referenceNo,
              remarks: data.remarks ?? null,
              recordedById: actor.id,
            },
          });

          // The paid and balance figures move by the payment itself: whatever the
          // receivable's own figures were, they are changed by exactly this amount.
          const paidAfter = toPaise(receivable.paidAmount) + amountPaise;
          const balanceAfter = balanceBefore - amountPaise;
          const statusAfter =
            balanceAfter <= 0
              ? RECEIVABLE_STATUS.PAID
              : RECEIVABLE_STATUS.PARTIAL;

          const moved = await tx.accountsReceivable.updateMany({
            where: {
              id: receivable.id,
              paidAmount: receivable.paidAmount,
              balanceAmount: receivable.balanceAmount,
              paymentStatus: receivable.paymentStatus,
            },
            data: {
              paidAmount: fromPaise(paidAfter),
              balanceAmount: fromPaise(balanceAfter),
              paymentStatus: statusAfter,
            },
          });

          if (moved.count === 0) {
            throw paymentConflict(
              'This receivable was changed while the payment was being recorded. Reload it and try again.',
              PAYMENT_CONFLICT_CODE.RECEIVABLE_CHANGED,
            );
          }

          const event = await tx.paymentCollectionEvent.create({
            data: {
              paymentCollectionId: paymentRecord.id,
              accountsReceivableId: receivable.id,
              salesInvoiceId: data.salesInvoiceId,
              action: PAYMENT_COLLECTION_EVENT_ACTION.PAYMENT_RECORDED,
              amount: fromPaise(amountPaise),
              balanceBefore: fromPaise(balanceBefore),
              balanceAfter: fromPaise(balanceAfter),
              fromStatus: receivable.paymentStatus,
              toStatus: statusAfter,
              remarks: data.remarks ?? null,
              actorId: actor.id,
              occurredAt: now,
            },
            include: EVENT_INCLUDE,
          });

          const updatedReceivable =
            await tx.accountsReceivable.findUniqueOrThrow({
              where: { id: receivable.id },
            });

          return {
            paymentRecord: {
              ...paymentRecord,
              recordedBy: { id: actor.id, fullName: actor.fullName },
            },
            updatedReceivable,
            event,
          };
        },
        { maxWait: 5000, timeout: 15000 },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The database's unique indexes are the final word when two requests
        // with the same reference race past the check above.
        throw paymentConflict(
          `A payment with the reference "${data.referenceNo}" is already recorded for this invoice.`,
          PAYMENT_CONFLICT_CODE.DUPLICATE_REFERENCE,
        );
      }

      if (isBusyError(error)) {
        throw paymentConflict(
          'This receivable is being updated by someone else right now. Try again in a moment.',
          PAYMENT_CONFLICT_CODE.RECEIVABLE_BUSY,
        );
      }

      throw error;
    }
  }

  // Newest payment first. Filters are all optional; the page is capped.
  async findAll(query: ListPaymentCollectionsQueryDto = {}) {
    const where: Prisma.PaymentCollectionWhereInput = {};

    if (query.accountsReceivableId) {
      where.accountsReceivableId = query.accountsReceivableId;
    }

    if (query.salesInvoiceId) {
      where.accountsReceivable = { salesInvoiceId: query.salesInvoiceId };
    }

    if (query.from || query.to) {
      where.paymentDate = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    return this.prisma.paymentCollection.findMany({
      where,
      include: COLLECTION_INCLUDE,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit ?? COLLECTIONS_LIST_DEFAULT_LIMIT,
      skip: query.offset ?? 0,
    });
  }

  async findOne(id: string) {
    const collection = await this.prisma.paymentCollection.findUnique({
      where: { id },
      include: {
        ...COLLECTION_INCLUDE,
        events: {
          include: EVENT_INCLUDE,
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!collection) {
      throw new NotFoundException(PAYMENT_COLLECTION_NOT_FOUND_MESSAGE);
    }

    return collection;
  }

  // One invoice's receivable with every payment collected against it and the
  // events behind them, in one call.
  async findByInvoice(salesInvoiceId: string) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: salesInvoiceId },
      select: INVOICE_SELECT,
    });

    if (!invoice) {
      throw new NotFoundException(INVOICE_NOT_FOUND_MESSAGE);
    }

    const receivables = await this.prisma.accountsReceivable.findMany({
      where: { salesInvoiceId },
      orderBy: { createdAt: 'asc' },
    });

    if (receivables.length === 0) {
      throw new NotFoundException(RECEIVABLE_NOT_FOUND_MESSAGE);
    }

    if (receivables.length > 1) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message:
          'This invoice has more than one receivable, so its collections cannot be shown as one.',
        code: PAYMENT_CONFLICT_CODE.AMBIGUOUS_RECEIVABLE,
      });
    }

    const receivable = receivables[0];

    const [collections, events] = await Promise.all([
      this.prisma.paymentCollection.findMany({
        where: { accountsReceivableId: receivable.id },
        include: { recordedBy: { select: ACTOR_SELECT } },
        orderBy: [
          { paymentDate: 'desc' },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
      }),
      this.prisma.paymentCollectionEvent.findMany({
        where: { accountsReceivableId: receivable.id },
        include: EVENT_INCLUDE,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    return {
      receivable: { ...receivable, salesInvoice: invoice },
      collections,
      events,
    };
  }
}
