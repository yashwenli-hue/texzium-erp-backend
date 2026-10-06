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
// Accounts gives commercial approval. Each step can be retracted, one step
// back and most recent first, and an order in any of the three statuses can be
// cancelled. CANCELLED is terminal: nothing leaves it, and nothing in the
// lifecycle moves an order into or out of it except cancel. Every later status
// (DISPATCH_ORDER_CREATED, READY_FOR_INVOICING, ...) belongs to OperationsOS
// and is not touched here; an order that has reached one can no longer be
// retracted or cancelled from RevenueOS.
export const SALES_ORDER_STATUS = {
  PENDING_STORE_APPROVAL: 'PENDING_STORE_APPROVAL',
  PENDING_ACCOUNTS_APPROVAL: 'PENDING_ACCOUNTS_APPROVAL',
  READY_FOR_DISPATCH_ORDER: 'READY_FOR_DISPATCH_ORDER',
  CANCELLED: 'CANCELLED',
} as const;

export const SALES_ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  [SALES_ORDER_STATUS.PENDING_STORE_APPROVAL]: [
    SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
  ],
  [SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL]: [
    SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
  ],
};

// Retract: undo the most recent RevenueOS approval, one step back.
export const SALES_ORDER_RETRACTIONS: Record<string, string> = {
  [SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL]:
    SALES_ORDER_STATUS.PENDING_STORE_APPROVAL,
  [SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER]:
    SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
};

// Cancel: the statuses an order can be cancelled from. Anything else (legacy
// OPEN, the OperationsOS statuses, CANCELLED itself) cannot.
export const SALES_ORDER_CANCELLABLE_STATUSES: readonly string[] = [
  SALES_ORDER_STATUS.PENDING_STORE_APPROVAL,
  SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
  SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
];

// Payment terms and advance receipts are collected while the order waits for
// store or accounts approval, and at no other time.
export const SALES_ORDER_DOCUMENT_STATUSES: readonly string[] = [
  SALES_ORDER_STATUS.PENDING_STORE_APPROVAL,
  SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
];

export const SALES_ORDER_EVENT_ACTION = {
  ADVANCE_RECEIPT_VERIFIED: 'ADVANCE_RECEIPT_VERIFIED',
  ADVANCE_RECEIPT_REJECTED: 'ADVANCE_RECEIPT_REJECTED',
  ACCOUNTS_APPROVED: 'ACCOUNTS_APPROVED',
  ADVANCE_RECEIPT_VERIFICATION_RETRACTED:
    'ADVANCE_RECEIPT_VERIFICATION_RETRACTED',
  ACCOUNTS_APPROVAL_RETRACTED: 'ACCOUNTS_APPROVAL_RETRACTED',
  SALES_ORDER_CANCELLED: 'SALES_ORDER_CANCELLED',
} as const;

export const SALES_ORDER_EVENT_RESULT = {
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  APPROVED: 'APPROVED',
  RETRACTED: 'RETRACTED',
  CANCELLED: 'CANCELLED',
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

export function isSalesOrderRetractionAllowed(
  from: string,
  to: string,
): boolean {
  return SALES_ORDER_RETRACTIONS[from] === to;
}

export function isSalesOrderCancellationAllowed(from: string): boolean {
  return SALES_ORDER_CANCELLABLE_STATUSES.includes(from);
}

export function canRecordSalesOrderDocuments(status: string): boolean {
  return SALES_ORDER_DOCUMENT_STATUSES.includes(status);
}

// A programming guard: callers name the transition they mean, and only the two
// lifecycle steps exist. It is never reached with client input.
export function assertSalesOrderTransition(from: string, to: string): void {
  if (!isSalesOrderTransitionAllowed(from, to)) {
    throw new Error(`Sales Order cannot move from ${from} to ${to}.`);
  }
}

export function assertSalesOrderRetraction(from: string, to: string): void {
  if (!isSalesOrderRetractionAllowed(from, to)) {
    throw new Error(`Sales Order cannot be retracted from ${from} to ${to}.`);
  }
}

export function assertSalesOrderCancellation(from: string): void {
  if (!isSalesOrderCancellationAllowed(from)) {
    throw new Error(`Sales Order cannot be cancelled from ${from}.`);
  }
}

type Tx = Prisma.TransactionClient;
type SalesOrderDb = Pick<Tx, 'salesOrder' | 'salesOrderEvent'>;

// Atomic compare-and-set: the order moves only if it is still in `from`. When
// two requests race, the second waits on the row, sees the new status, matches
// nothing and gets false, so an order can never advance twice.
async function setStatusIfStill(
  tx: Pick<Tx, 'salesOrder'>,
  salesOrderId: string,
  from: string,
  to: string,
): Promise<boolean> {
  const result = await tx.salesOrder.updateMany({
    where: { id: salesOrderId, status: from },
    data: { status: to },
  });

  return result.count === 1;
}

export async function advanceSalesOrder(
  tx: Pick<Tx, 'salesOrder'>,
  salesOrderId: string,
  from: string,
  to: string,
): Promise<boolean> {
  assertSalesOrderTransition(from, to);

  return setStatusIfStill(tx, salesOrderId, from, to);
}

// The same compare-and-set, one step back.
export async function retractSalesOrder(
  tx: Pick<Tx, 'salesOrder'>,
  salesOrderId: string,
  from: string,
  to: string,
): Promise<boolean> {
  assertSalesOrderRetraction(from, to);

  return setStatusIfStill(tx, salesOrderId, from, to);
}

// The same compare-and-set into CANCELLED, from the status the caller read
// while holding the row lock.
export async function cancelSalesOrderStatus(
  tx: Pick<Tx, 'salesOrder'>,
  salesOrderId: string,
  from: string,
): Promise<boolean> {
  assertSalesOrderCancellation(from);

  return setStatusIfStill(tx, salesOrderId, from, SALES_ORDER_STATUS.CANCELLED);
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

// Reads the order's status and locks the row against every other writer
// (FOR UPDATE), including the foreign-key checks of rows being inserted that
// point at it (invoices, dispatch orders, ...). Retraction and cancellation
// use it so the downstream checks they make and the status change they commit
// are one atomic decision.
export async function lockSalesOrder(
  tx: Tx,
  salesOrderId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT "status"
    FROM "SalesOrder"
    WHERE "id" = ${salesOrderId}
    FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new NotFoundException(SALES_ORDER_NOT_FOUND_MESSAGE);
  }

  return rows[0].status;
}

// OperationsOS and FinanceOS own everything below. If any of it exists for the
// order, RevenueOS no longer decides what happens to the order. Cancelling
// additionally refuses when procurement has acted on the order's purchase
// requisition (approved, or a purchase order raised) or stock is reserved for
// it. A requisition that is still PENDING or was REJECTED is left exactly as
// it is.
export async function assertNoDownstreamWork(
  tx: Pick<
    Tx,
    | 'dispatchOrder'
    | 'dispatch'
    | 'salesInvoice'
    | 'purchaseRequisition'
    | 'purchaseOrder'
    | 'inventoryReservation'
  >,
  salesOrderId: string,
  action: 'retract' | 'cancel',
): Promise<void> {
  const verb = action === 'retract' ? 'retracted' : 'cancelled';
  const blockers: string[] = [];

  if ((await tx.dispatchOrder.count({ where: { salesOrderId } })) > 0) {
    blockers.push('a Dispatch Order');
  }
  if ((await tx.dispatch.count({ where: { salesOrderId } })) > 0) {
    blockers.push('a Dispatch');
  }
  if ((await tx.salesInvoice.count({ where: { salesOrderId } })) > 0) {
    blockers.push('a Sales Invoice');
  }

  if (action === 'cancel') {
    if (
      (await tx.purchaseRequisition.count({
        where: {
          salesOrderId,
          status: { notIn: ['PENDING', 'REJECTED'] },
        },
      })) > 0 ||
      (await tx.purchaseOrder.count({
        where: { purchaseRequisition: { salesOrderId } },
      })) > 0
    ) {
      blockers.push('an approved Purchase Requisition or a Purchase Order');
    }
    if (
      (await tx.inventoryReservation.count({
        where: { salesOrderId, status: 'RESERVED' },
      })) > 0
    ) {
      blockers.push('reserved stock');
    }
  }

  if (blockers.length > 0) {
    throw new ConflictException(
      `This Sales Order can no longer be ${verb} here: it already has ${blockers.join(' and ')}. Operations or Finance has taken it from here.`,
    );
  }
}

// The advance-receipt and approval events are the proof that a step belongs to
// this lifecycle. Only a step with its event can be retracted, so records that
// predate the lifecycle (or were edited by hand) can never be.
export async function assertLifecycleEvent(
  tx: Pick<Tx, 'salesOrderEvent'>,
  salesOrderId: string,
  action: string,
  referenceId: string,
  what: string,
): Promise<void> {
  const found = await tx.salesOrderEvent.findFirst({
    where: { salesOrderId, action, referenceId },
    select: { id: true },
  });

  if (!found) {
    throw new ConflictException(
      `This ${what} was not recorded by the Sales Order workflow, so it cannot be retracted here.`,
    );
  }
}

export function recordSalesOrderEvent(
  tx: Pick<SalesOrderDb, 'salesOrderEvent'>,
  event: {
    salesOrderId: string;
    action: string;
    result: string;
    fromStatus: string;
    toStatus: string;
    referenceId?: string;
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

export function conflictCannotRetract(
  what: string,
  requiredStatus: string,
  currentStatus: string,
): ConflictException {
  return new ConflictException(
    `${what} can only be retracted while the Sales Order is ${salesOrderStatusLabel(requiredStatus)} (now ${salesOrderStatusLabel(currentStatus)}).`,
  );
}

export function conflictCannotCancel(currentStatus: string): ConflictException {
  if (currentStatus === SALES_ORDER_STATUS.CANCELLED) {
    return new ConflictException('This Sales Order is already cancelled.');
  }

  return new ConflictException(
    `This Sales Order cannot be cancelled here (now ${salesOrderStatusLabel(currentStatus)}). Only an order that is Pending Store Approval, Pending Accounts Approval or Ready For Dispatch Order can be cancelled.`,
  );
}

// Payment terms and advance receipts cannot be recorded on an order that is
// not waiting for store or accounts approval.
export function conflictNotAcceptingDocuments(
  what: string,
  currentStatus: string,
): ConflictException {
  if (currentStatus === SALES_ORDER_STATUS.CANCELLED) {
    return new ConflictException(
      `This Sales Order has been cancelled, so ${what} can no longer be recorded.`,
    );
  }

  return new ConflictException(
    `${what[0].toUpperCase()}${what.slice(1)} can only be recorded while the Sales Order is Pending Store Approval or Pending Accounts Approval (now ${salesOrderStatusLabel(currentStatus)}).`,
  );
}
