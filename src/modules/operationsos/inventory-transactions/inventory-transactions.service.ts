import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';

@Injectable()
export class InventoryTransactionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateInventoryTransactionDto) {
    return this.prisma.$transaction(async (tx) => {

      const item = await tx.inventoryItem.findUnique({
        where: {
          id: data.inventoryItemId,
        },
      });

      if (!item) {
        throw new Error('Inventory Item not found');
      }

      const balanceAfter = item.stockQty + data.quantity;

      const transaction = await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: data.inventoryItemId,

          warehouseId: data.warehouseId,
          binLocation: data.binLocation,

          transactionType: data.transactionType,

          referenceModule: data.referenceModule,
          referenceId: data.referenceId,

          quantity: data.quantity,

          balanceAfter,

          remarks: data.remarks,

          createdBy: data.createdBy,
        },
      });

      await tx.inventoryItem.update({
        where: {
          id: item.id,
        },
        data: {
          stockQty: balanceAfter,
          availableQty: balanceAfter - item.reservedQty,
        },
      });

      return transaction;
    });
  }

  async findAll() {
    return this.prisma.inventoryTransaction.findMany({
      include: {
        inventoryItem: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
