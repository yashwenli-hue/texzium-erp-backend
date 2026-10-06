import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { QUOTATION_AMOUNT_TOLERANCE } from '../quotations/quotation-values';

// The Proforma Invoice lifecycle, kept on the existing customerStatus column:
//
//   PENDING -> APPROVED | CANCELLED
//   APPROVED -> CANCELLED
//
// A Proforma is created PENDING from an APPROVED Quotation and its total is
// the Quotation's. Only an APPROVED, unexpired Proforma can be turned into a
// Sales Order. CANCELLED is terminal, and a Proforma can be cancelled only
// while no Sales Order that is not cancelled references it.
//
// Expiry is not a status. A Proforma with a validity date is valid through the
// end of that calendar day (UTC) and expired from then on, which is worked out
// whenever it matters (approval, Sales Order creation, listing) and never
// stored.
export const PROFORMA_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  CANCELLED: 'CANCELLED',
} as const;

export const PROFORMA_TRANSITIONS: Record<string, readonly string[]> = {
  [PROFORMA_STATUS.PENDING]: [
    PROFORMA_STATUS.APPROVED,
    PROFORMA_STATUS.CANCELLED,
  ],
  [PROFORMA_STATUS.APPROVED]: [PROFORMA_STATUS.CANCELLED],
};

export const PROFORMA_EVENT_ACTION = {
  PROFORMA_CREATED: 'PROFORMA_CREATED',
  PROFORMA_APPROVED: 'PROFORMA_APPROVED',
  PROFORMA_CANCELLED: 'PROFORMA_CANCELLED',
} as const;

export const PROFORMA_NOT_FOUND_MESSAGE = 'Proforma Invoice not found.';

// "PENDING" -> "Pending".
export function proformaStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function isProformaTransitionAllowed(from: string, to: string): boolean {
  return (PROFORMA_TRANSITIONS[from] ?? []).includes(to);
}

// A programming guard: callers name the transition they mean. It is never
// reached with client input.
export function assertProformaTransition(from: string, to: string): void {
  if (!isProformaTransitionAllowed(from, to)) {
    throw new Error(`Proforma Invoice cannot move from ${from} to ${to}.`);
  }
}

// ----------------------------------------------------------------------
// Validity
// ----------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// Valid through the end of the validity date's calendar day (UTC): expired
// once the next day begins. No validity date means no expiry.
export function isProformaExpired(
  validityDate: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!validityDate) {
    return false;
  }

  const startOfValidityDay = Date.UTC(
    validityDate.getUTCFullYear(),
    validityDate.getUTCMonth(),
    validityDate.getUTCDate(),
  );

  return now.getTime() >= startOfValidityDay + DAY_MS;
}

export function formatValidityDate(validityDate: Date): string {
  return validityDate.toISOString().slice(0, 10);
}

// The Proforma's total is its Quotation's. They may differ by no more than the
// quotation tolerance (a paisa). The tiny extra margin keeps a difference of
// exactly a paisa from being refused over floating-point representation
// (275000.01 - 275000 is a hair over 0.01).
const FLOAT_MARGIN = 1e-6;

export function totalsMatch(a: number, b: number): boolean {
  return Math.abs(a - b) <= QUOTATION_AMOUNT_TOLERANCE + FLOAT_MARGIN;
}

// ----------------------------------------------------------------------
// Persistence helpers
// ----------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

// Locks the Proforma row against every other writer (FOR UPDATE), including
// the foreign-key checks of Sales Orders being inserted that point at it. Every
// lifecycle action reads the status and takes its decision while holding the
// lock, so a cancellation that looks for Sales Orders and the status change it
// commits are one atomic decision, and Sales Order creation (which takes the
// same lock) is serialised with it.
export async function lockProforma(
  tx: Tx,
  proformaInvoiceId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ customerStatus: string }>>`
    SELECT "customerStatus"
    FROM "ProformaInvoice"
    WHERE "id" = ${proformaInvoiceId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(PROFORMA_NOT_FOUND_MESSAGE);
  }

  return rows[0].customerStatus;
}

// Reads the Quotation's status while holding a shared row lock. Sales Order
// creation uses it, so "the Quotation is APPROVED" cannot change under it: a
// revision, approval or rejection of the Quotation waits for the order.
export async function readQuotationStatusShared(
  tx: Tx,
  quotationId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status"
    FROM "Quotation"
    WHERE "id" = ${quotationId}
    FOR SHARE
  `;

  if (rows.length === 0) {
    throw new NotFoundException('Quotation not found.');
  }

  return rows[0].status;
}

export async function requireProforma(
  db: Pick<Tx, 'proformaInvoice'>,
  proformaInvoiceId: string,
): Promise<{ id: string }> {
  const proforma = await db.proformaInvoice.findUnique({
    where: { id: proformaInvoiceId },
    select: { id: true },
  });

  if (!proforma) {
    throw new NotFoundException(PROFORMA_NOT_FOUND_MESSAGE);
  }

  return proforma;
}

// Atomic compare-and-set: the Proforma moves only if it is still in `from`.
// The caller holds the row lock, so this cannot fail in practice; it is the
// second layer that keeps a status change from ever being applied to a row
// that has moved on.
export async function setProformaStatusIfStill(
  tx: Pick<Tx, 'proformaInvoice'>,
  proformaInvoiceId: string,
  from: string,
  to: string,
): Promise<boolean> {
  assertProformaTransition(from, to);

  const result = await tx.proformaInvoice.updateMany({
    where: { id: proformaInvoiceId, customerStatus: from },
    data: { customerStatus: to },
  });

  return result.count === 1;
}

// A Proforma that has a Sales Order that is not cancelled cannot be cancelled:
// RevenueOS no longer decides what happens to it until that order is cancelled.
export async function assertNoLiveSalesOrder(
  tx: Pick<Tx, 'salesOrder'>,
  proformaInvoiceId: string,
): Promise<void> {
  const live = await tx.salesOrder.count({
    where: { proformaInvoiceId, status: { not: 'CANCELLED' } },
  });

  if (live > 0) {
    throw new ConflictException(
      'This Proforma Invoice can no longer be cancelled: a Sales Order was created from it. Cancel the Sales Order first.',
    );
  }
}

export function recordProformaEvent(
  tx: Pick<Tx, 'proformaEvent'>,
  event: {
    proformaInvoiceId: string;
    action: string;
    fromStatus?: string;
    toStatus: string;
    remarks?: string;
    actorId: string;
    occurredAt: Date;
  },
) {
  return tx.proformaEvent.create({
    data: {
      proformaInvoiceId: event.proformaInvoiceId,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      remarks: event.remarks,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
    },
  });
}

// The authenticated user. The actor of every event is always the id of the
// signed-in user; a request cannot name one.
export async function requireProformaActor(
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

export function conflictQuotationNotApproved(
  currentStatus: string,
): ConflictException {
  return new ConflictException(
    `A Proforma Invoice can only be created from an APPROVED Quotation (now ${currentStatus}).`,
  );
}

export function conflictActiveProformaExists(): ConflictException {
  return new ConflictException(
    'This Quotation already has an active Proforma Invoice. Cancel it before creating another.',
  );
}

export function conflictCannotApprove(
  currentStatus: string,
): ConflictException {
  if (currentStatus === PROFORMA_STATUS.APPROVED) {
    return new ConflictException('This Proforma Invoice is already approved.');
  }
  if (currentStatus === PROFORMA_STATUS.CANCELLED) {
    return new ConflictException(
      'This Proforma Invoice has been cancelled and can no longer be approved.',
    );
  }

  return new ConflictException(
    `This Proforma Invoice cannot be approved (now ${proformaStatusLabel(currentStatus)}).`,
  );
}

export function conflictCannotCancel(currentStatus: string): ConflictException {
  if (currentStatus === PROFORMA_STATUS.CANCELLED) {
    return new ConflictException('This Proforma Invoice is already cancelled.');
  }

  return new ConflictException(
    `This Proforma Invoice cannot be cancelled (now ${proformaStatusLabel(currentStatus)}).`,
  );
}

export function conflictExpired(
  validityDate: Date,
  action: 'approved' | 'used to create a Sales Order',
): ConflictException {
  return new ConflictException(
    `This Proforma Invoice expired on ${formatValidityDate(validityDate)} and can no longer be ${action}.`,
  );
}

export function conflictParentQuotationNotApproved(
  currentStatus: string,
): ConflictException {
  return new ConflictException(
    `A Sales Order can only be created while the Proforma Invoice's Quotation is APPROVED (now ${currentStatus}).`,
  );
}

export function conflictTotalsDiffer(
  proformaTotal: number,
  quotationTotal: number,
): ConflictException {
  return new ConflictException(
    `This Proforma Invoice (${proformaTotal}) no longer matches its Quotation total (${quotationTotal}), so a Sales Order cannot be created from it.`,
  );
}
