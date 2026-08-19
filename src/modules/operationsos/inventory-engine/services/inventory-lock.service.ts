import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Prisma } from '@prisma/client';

@Injectable()
export class InventoryLockService {
  async lockInventoryItem(
    tx: Prisma.TransactionClient,
    inventoryItemId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "InventoryItem"
      WHERE "id" = ${inventoryItemId}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException(
        'Inventory Item not found.',
      );
    }
  }

  async lockDispatchOrderItem(
    tx: Prisma.TransactionClient,
    dispatchOrderItemId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "DispatchOrderItem"
      WHERE "id" = ${dispatchOrderItemId}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException(
        'Dispatch Order Item not found.',
      );
    }
  }

  async lockDispatchOrder(
    tx: Prisma.TransactionClient,
    dispatchOrderId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "DispatchOrder"
      WHERE "id" = ${dispatchOrderId}
      FOR UPDATE
    `;

    if (rows.length === 0) {
      throw new NotFoundException(
        'Dispatch Order not found.',
      );
    }
  }
}
