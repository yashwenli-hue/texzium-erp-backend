import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SALES_ORDER_NOT_FOUND_MESSAGE } from '../sales-orders/sales-order-lifecycle';

// Invoicing locks its Sales Order row exclusively (FOR UPDATE) for the whole
// transaction and reads its status under the lock. That makes "the order is not
// cancelled", "the order has no invoice yet" and the insert one decision: a
// cancellation (which takes the same lock) waits for the invoice and then sees
// it, and a second invoice for the same order waits and then sees the first.
// Kept separate from the cancellation's own lock helper so each can be tested
// on its own.
export async function lockSalesOrderForInvoice(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  salesOrderId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ status: string }>>`
    /* sales-invoice:lock-order */
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
