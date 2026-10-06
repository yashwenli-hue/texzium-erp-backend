import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { QUOTATION_AMOUNT_TOLERANCE } from './quotation-values';

// The Quotation lifecycle:
//
//   DRAFT -> REVISED | APPROVED | REJECTED
//   REVISED -> REVISED | APPROVED | REJECTED
//   APPROVED -> REVISED   (only while nothing has been built on it)
//
// REVISED means the amounts changed after creation or after an approval and
// the quotation needs (re-)approval. An APPROVED quotation is otherwise
// immutable, and can go back to REVISED only while it has no active Proforma
// Invoice and no Sales Order that is not cancelled. REJECTED is terminal. The
// status is stored as plain text and a quotation never leaves the four
// statuses below (a status written before this lifecycle existed is one of
// them too: the backend only ever wrote DRAFT, REVISED and APPROVED).
export const QUOTATION_STATUS = {
  DRAFT: 'DRAFT',
  REVISED: 'REVISED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export const QUOTATION_TRANSITIONS: Record<string, readonly string[]> = {
  [QUOTATION_STATUS.DRAFT]: [
    QUOTATION_STATUS.REVISED,
    QUOTATION_STATUS.APPROVED,
    QUOTATION_STATUS.REJECTED,
  ],
  [QUOTATION_STATUS.REVISED]: [
    QUOTATION_STATUS.REVISED,
    QUOTATION_STATUS.APPROVED,
    QUOTATION_STATUS.REJECTED,
  ],
  [QUOTATION_STATUS.APPROVED]: [QUOTATION_STATUS.REVISED],
};

export const QUOTATION_EVENT_ACTION = {
  QUOTATION_CREATED: 'QUOTATION_CREATED',
  QUOTATION_REVISED: 'QUOTATION_REVISED',
  QUOTATION_APPROVED: 'QUOTATION_APPROVED',
  QUOTATION_REJECTED: 'QUOTATION_REJECTED',
} as const;

export const QUOTATION_NOT_FOUND_MESSAGE = 'Quotation not found.';

// The Proforma status that takes a Proforma out of play. Until Proformas get a
// lifecycle of their own it is never written, so every existing Proforma is
// active.
const PROFORMA_CANCELLED_STATUS = 'CANCELLED';
const SALES_ORDER_CANCELLED_STATUS = 'CANCELLED';

// "REVISED" -> "Revised".
export function quotationStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function isQuotationTransitionAllowed(
  from: string,
  to: string,
): boolean {
  return (QUOTATION_TRANSITIONS[from] ?? []).includes(to);
}

// A programming guard: callers name the transition they mean. It is never
// reached with client input.
export function assertQuotationTransition(from: string, to: string): void {
  if (!isQuotationTransitionAllowed(from, to)) {
    throw new Error(`Quotation cannot move from ${from} to ${to}.`);
  }
}

// ----------------------------------------------------------------------
// Amounts
// ----------------------------------------------------------------------

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type QuotationAmounts = {
  taxableAmount: number;
  gstPercent: number;
  gstAmount: number;
  totalAmount: number;
};

// The backend is authoritative for a quotation's amounts. Quantity and unit
// price are not stored, so a revision works on the taxable amount: GST comes
// from the percentage the quotation already carries, and the total is the sum.
export function computeQuotationAmounts(
  taxableAmount: number,
  gstPercent: number,
): { taxableAmount: number; gstAmount: number; totalAmount: number } {
  const taxable = roundMoney(taxableAmount);
  const gstAmount = roundMoney((taxable * gstPercent) / 100);

  return {
    taxableAmount: taxable,
    gstAmount,
    totalAmount: roundMoney(taxable + gstAmount),
  };
}

// A quotation's stored amounts hang together: taxable + GST is the total, GST is
// the stated percentage of the taxable amount, and there is something to sell.
// Quotations created through the API always satisfy this. Some that predate
// this lifecycle do not (their tax breakdown was never stored, or a revision
// changed the total alone); they are left as they are and cannot be revised or
// approved, because the backend cannot say what their tax should be.
export function hasConsistentTaxBreakdown(q: QuotationAmounts): boolean {
  const near = (a: number, b: number) =>
    Math.abs(a - b) <= QUOTATION_AMOUNT_TOLERANCE;

  return (
    [q.taxableAmount, q.gstPercent, q.gstAmount, q.totalAmount].every(
      Number.isFinite,
    ) &&
    q.taxableAmount > 0 &&
    near(q.taxableAmount + q.gstAmount, q.totalAmount) &&
    near((q.taxableAmount * q.gstPercent) / 100, q.gstAmount)
  );
}

// ----------------------------------------------------------------------
// Persistence helpers
// ----------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

// Locks the quotation row against every other writer (FOR UPDATE), including
// the foreign-key checks of rows being inserted that point at it (Proforma
// Invoices). Every lifecycle action reads the status and takes its decision
// while holding the lock, so a revision that checks for a Proforma and the
// status change it commits are one atomic decision.
export async function lockQuotation(
  tx: Tx,
  quotationId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status"
    FROM "Quotation"
    WHERE "id" = ${quotationId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(QUOTATION_NOT_FOUND_MESSAGE);
  }

  return rows[0].status;
}

export async function requireQuotation(
  db: Pick<Tx, 'quotation'>,
  quotationId: string,
): Promise<{ id: string }> {
  const quotation = await db.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true },
  });

  if (!quotation) {
    throw new NotFoundException(QUOTATION_NOT_FOUND_MESSAGE);
  }

  return quotation;
}

// Atomic compare-and-set: the quotation moves only if it is still in `from`.
// The caller holds the row lock, so this cannot fail in practice; it is the
// second layer that keeps a status change from ever being applied to a row
// that has moved on.
export async function setQuotationStatusIfStill(
  tx: Pick<Tx, 'quotation'>,
  quotationId: string,
  from: string,
  to: string,
  extra: Prisma.QuotationUncheckedUpdateManyInput = {},
): Promise<boolean> {
  assertQuotationTransition(from, to);

  const result = await tx.quotation.updateMany({
    where: { id: quotationId, status: from },
    data: { ...extra, status: to },
  });

  return result.count === 1;
}

// RevenueOS no longer decides what happens to an approved quotation once a
// Proforma Invoice is active against it or a Sales Order that is not cancelled
// was created from it (directly, or through one of its Proformas).
export async function assertNoActiveDownstreamDocuments(
  tx: Pick<Tx, 'proformaInvoice' | 'salesOrder'>,
  quotationId: string,
): Promise<void> {
  const blockers: string[] = [];

  if (
    (await tx.proformaInvoice.count({
      where: {
        quotationId,
        customerStatus: { not: PROFORMA_CANCELLED_STATUS },
      },
    })) > 0
  ) {
    blockers.push('an active Proforma Invoice');
  }

  if (
    (await tx.salesOrder.count({
      where: {
        status: { not: SALES_ORDER_CANCELLED_STATUS },
        OR: [{ quotationId }, { proformaInvoice: { quotationId } }],
      },
    })) > 0
  ) {
    blockers.push('a Sales Order');
  }

  if (blockers.length > 0) {
    throw new ConflictException(
      `This Quotation can no longer be revised: it already has ${blockers.join(' and ')}. Cancel them first.`,
    );
  }
}

export function recordQuotationEvent(
  tx: Pick<Tx, 'quotationEvent'>,
  event: {
    quotationId: string;
    action: string;
    fromStatus?: string;
    toStatus: string;
    remarks?: string;
    previousTaxableAmount?: number;
    newTaxableAmount?: number;
    previousTotalAmount?: number;
    newTotalAmount?: number;
    actorId: string;
    occurredAt: Date;
  },
) {
  return tx.quotationEvent.create({
    data: {
      quotationId: event.quotationId,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      remarks: event.remarks,
      previousTaxableAmount: event.previousTaxableAmount,
      newTaxableAmount: event.newTaxableAmount,
      previousTotalAmount: event.previousTotalAmount,
      newTotalAmount: event.newTotalAmount,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
    },
  });
}

// The authenticated user. The actor of every event is always the id of the
// signed-in user; a request cannot name one.
export async function requireQuotationActor(
  db: { user: Pick<Prisma.UserDelegate, 'findUnique'> },
  actorId: string | undefined,
): Promise<{ id: string }> {
  if (!actorId) {
    throw new UnauthorizedException('Authenticated user required.');
  }

  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { id: true },
  });

  if (!actor) {
    throw new UnauthorizedException('Authenticated user not found.');
  }

  return actor;
}

// ----------------------------------------------------------------------
// Conflicts
// ----------------------------------------------------------------------

export function conflictCannotApprove(
  currentStatus: string,
): ConflictException {
  if (currentStatus === QUOTATION_STATUS.APPROVED) {
    return new ConflictException('This Quotation is already approved.');
  }
  if (currentStatus === QUOTATION_STATUS.REJECTED) {
    return new ConflictException(
      'This Quotation has been rejected and can no longer be approved.',
    );
  }

  return new ConflictException(
    `This Quotation cannot be approved (now ${quotationStatusLabel(currentStatus)}).`,
  );
}

export function conflictCannotRevise(currentStatus: string): ConflictException {
  if (currentStatus === QUOTATION_STATUS.REJECTED) {
    return new ConflictException(
      'This Quotation has been rejected and can no longer be revised.',
    );
  }

  return new ConflictException(
    `This Quotation cannot be revised (now ${quotationStatusLabel(currentStatus)}).`,
  );
}

export function conflictCannotReject(currentStatus: string): ConflictException {
  if (currentStatus === QUOTATION_STATUS.REJECTED) {
    return new ConflictException('This Quotation is already rejected.');
  }
  if (currentStatus === QUOTATION_STATUS.APPROVED) {
    return new ConflictException(
      'An approved Quotation cannot be rejected. Revise it first.',
    );
  }

  return new ConflictException(
    `This Quotation cannot be rejected (now ${quotationStatusLabel(currentStatus)}).`,
  );
}

export function conflictInconsistentTaxBreakdown(
  action: 'approved' | 'revised',
): ConflictException {
  return new ConflictException(
    `This Quotation cannot be ${action}: its stored tax breakdown does not add up to its total, so the system cannot say what its tax should be. Create a new Quotation instead.`,
  );
}
