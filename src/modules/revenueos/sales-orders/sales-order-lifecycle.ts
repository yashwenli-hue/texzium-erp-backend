import {
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

// The RevenueOS-owned stretch of the Sales Order lifecycle:
//
//   PENDING_STORE_APPROVAL -> PENDING_ACCOUNTS_APPROVAL -> READY_FOR_DISPATCH_ORDER
//
// The first step happens when an advance receipt is verified, the second when
// Accounts gives commercial approval. Every later status (DISPATCH_ORDER_CREATED,
// READY_FOR_INVOICING, ...) belongs to OperationsOS and is not touched here, and
// there are no cancel or close states yet.
export const SALES_ORDER_STATUS = {
  PENDING_STORE_APPROVAL: 'PENDING_STORE_APPROVAL',
  PENDING_ACCOUNTS_APPROVAL: 'PENDING_ACCOUNTS_APPROVAL',
  READY_FOR_DISPATCH_ORDER: 'READY_FOR_DISPATCH_ORDER',
} as const;

export const SALES_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  [SALES_ORDER_STATUS.PENDING_STORE_APPROVAL]: [
    SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
  ],
  [SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL]: [
    SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
  ],
};

export const SALES_ORDER_EVENT_ACTION = {
  ADVANCE_RECEIPT_VERIFIED: 'ADVANCE_RECEIPT_VERIFIED',
  ADVANCE_RECEIPT_REJECTED: 'ADVANCE_RECEIPT_REJECTED',
  ACCOUNTS_APPROVED: 'ACCOUNTS_APPROVED',
} as const;

export const SALES_ORDER_EVENT_RESULT = {
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
} as const;

export const SALES_ORDER_NOT_FOUND_MESSAGE = 'Sales Order not found.';

// "PENDING_ACCOUNTS_APPROVAL" -> "Pending Accounts Approval". A status outside
// the lifecycle (OPEN, DISPATCH_ORDER_CREATED, ...) is shown the same way.
export function salesOrderStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function isSalesOrderTransitionAllowed(
  from: string,
  to: string,
): boolean {
  return (SALES_ORDER_TRANSITIONS[from] ?? []).includes(to);
}

// A programming guard: callers name the transition they mean, and only the two
// lifecycle steps exist. It is never reached with client input.
export function assertSalesOrderTransition(from: string, to: string): void {
  if (!isSalesOrderTransitionAllowed(from, to)) {
    throw new Error(`Sales Order cannot move from ${from} to ${to}.`);
  }
}

type Tx = Prisma.TransactionClient;
type SalesOrderDb = Pick<Tx, 'salesOrder' | 'salesOrderEvent'>;

// Atomic compare-and-set: the order moves only if it is still in `from`. When
// two requests race, the second waits on the row, sees the new status, matches
// nothing and gets false, so an order can never advance twice.
export async function advanceSalesOrder(
  tx: Pick<Tx, 'salesOrder'>,
  salesOrderId: string,
  from: string,
  to: string,
): Promise<boolean> {
  assertSalesOrderTransition(from, to);

  const result = await tx.salesOrder.updateMany({
    where: { id: salesOrderId, status: from },
    data: { status: to },
  });

  return result.count === 1;
}

export async function requireSalesOrder(
  tx: Pick<Tx, 'salesOrder'>,
  salesOrderId: string,
): Promise<{ id: string; status: string }> {
  const order = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: { id: true, status: true },
  });

  if (!order) {
    throw new NotFoundException(SALES_ORDER_NOT_FOUND_MESSAGE);
  }

  return order;
}

// Reads the order's status while holding a shared row lock, so an event that
// records "the order stayed at X" is accurate even if another request is moving
// the same order at that moment.
export async function readSalesOrderStatusShared(
  tx: Tx,
  salesOrderId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status"
    FROM "SalesOrder"
    WHERE "id" = ${salesOrderId}
    FOR SHARE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(SALES_ORDER_NOT_FOUND_MESSAGE);
  }

  return rows[0].status;
}

export function recordSalesOrderEvent(
  tx: Pick<SalesOrderDb, 'salesOrderEvent'>,
  event: {
    salesOrderId: string;
    action: string;
    result: string;
    fromStatus: string;
    toStatus: string;
    referenceId: string;
    remarks?: string;
    actorId: string;
    occurredAt: Date;
  },
) {
  return tx.salesOrderEvent.create({
    data: {
      salesOrderId: event.salesOrderId,
      action: event.action,
      result: event.result,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      referenceId: event.referenceId,
      remarks: event.remarks,
      actorId: event.actorId,
      occurredAt: event.occurredAt,
    },
  });
}

// The authenticated user, looked up so the legacy verifiedBy/approvedBy text
// columns can carry their name. The actor itself is always the id.
export async function requireActor(
  db: { user: Pick<Prisma.UserDelegate, 'findUnique'> },
  actorId: string | undefined,
): Promise<{ id: string; fullName: string }> {
  if (!actorId) {
    throw new UnauthorizedException('Authenticated user required.');
  }

  const actor = await db.user.findUnique({
    where: { id: actorId },
    select: { id: true, fullName: true },
  });

  if (!actor) {
    throw new UnauthorizedException('Authenticated user not found.');
  }

  return actor;
}

export function conflictNotWaiting(
  what: string,
  currentStatus: string,
): ConflictException {
  return new ConflictException(
    `This Sales Order is not waiting for ${what} (now ${salesOrderStatusLabel(currentStatus)}).`,
  );
}
