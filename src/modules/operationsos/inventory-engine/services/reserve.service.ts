import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { ReserveInventoryDto } from '../dto/reserve-inventory.dto';

@Injectable()
export class ReserveService {
  constructor(private prisma: PrismaService) {}

  async execute(data: ReserveInventoryDto) {
    return this.prisma.$transaction(async (tx) => {

      const inventory = await tx.inventoryItem.findUnique({
        where: {
          id: data.inventoryItemId,
        },
      });

      if (!inventory) {
        throw new Error('Inventory Item not found');
      }

      const dispatchItem = await tx.dispatchOrderItem.findUnique({
        where: {
          id: data.dispatchOrderItemId,
        },
      });

      if (!dispatchItem) {
        throw new Error('Dispatch Order Item not found');
      }

      if (inventory.availableQty < data.quantity) {
        throw new Error('Insufficient available stock');
      }

      const newReservedQty = inventory.reservedQty + data.quantity;
      const newAvailableQty = inventory.stockQty - newReservedQty;

      await tx.inventoryItem.update({
        where: {
          id: inventory.id,
        },
        data: {
          reservedQty: newReservedQty,
          availableQty: newAvailableQty,
        },
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: inventory.id,
          warehouseId: data.warehouseId,
          binLocation: data.binLocation,
          transactionType: 'SALES_RESERVATION',
          referenceModule: 'DispatchOrder',
          referenceId: dispatchItem.id,
          quantity: -data.quantity,
          balanceAfter: newAvailableQty,
          remarks: data.remarks,
          createdBy: data.reservedBy,
        },
      });

      await tx.dispatchOrderItem.update({
        where: {
          id: dispatchItem.id,
        },
        data: {
          inventoryItemId: inventory.id,
          reservedQty: dispatchItem.reservedQty + data.quantity,
          isReserved: true,
          warehouseId: data.warehouseId,
          binLocation: data.binLocation,
        },
      });

      return {
        success: true,
        message: 'Inventory reserved successfully.',
        inventory,
        transaction,
      };
    });
  }
}
