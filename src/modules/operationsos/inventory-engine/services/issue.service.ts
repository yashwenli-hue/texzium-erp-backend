import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { IssueStockInput } from '../interfaces/issue-stock.interface';
import { MovementService } from './movement.service';

@Injectable()
export class IssueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
  ) {}

  async issueStock(
    tx: Prisma.TransactionClient,
    data: IssueStockInput,
  ) {
    if (data.quantity <= 0) {
      throw new BadRequestException(
        'Issue quantity must be greater than zero.',
      );
    }

    const inventory = await tx.inventoryItem.findUnique({
      where: {
        id: data.inventoryItemId,
      },
    });

    if (!inventory) {
      throw new NotFoundException(
        'Inventory Item not found.',
      );
    }

    if (!data.warehouseId) {
      throw new BadRequestException(
        'Warehouse is required for stock issue.',
      );
    }

    const dispatchItem = data.dispatchOrderItemId
      ? await tx.dispatchOrderItem.findUnique({
          where: {
            id: data.dispatchOrderItemId,
          },
        })
      : null;

    if (data.dispatchOrderItemId && !dispatchItem) {
      throw new NotFoundException(
        'Dispatch Order Item not found.',
      );
    }

    if (
      dispatchItem &&
      dispatchItem.inventoryItemId !== data.inventoryItemId
    ) {
      throw new BadRequestException(
        'Dispatch Order Item does not match the Inventory Item.',
      );
    }

    if (dispatchItem && !dispatchItem.isPacked) {
      throw new BadRequestException(
        'Inventory has not been packed.',
      );
    }

    if (
      dispatchItem &&
      data.quantity > dispatchItem.packedQty
    ) {
      throw new BadRequestException(
        'Issue quantity exceeds packed quantity.',
      );
    }

    let warehouseBinId: string | null = null;

    if (dispatchItem?.binLocation) {
      const bin = await tx.warehouseBin.findFirst({
        where: {
          code: dispatchItem.binLocation,
          warehouseRack: {
            warehouseZone: {
              warehouseId: data.warehouseId,
            },
          },
        },
      });

      if (!bin) {
        throw new NotFoundException(
          'Warehouse bin not found for the Dispatch Order Item.',
        );
      }

      warehouseBinId = bin.id;
    }

    const balance = await tx.inventoryBalance.findFirst({
      where: {
        inventoryItemId: data.inventoryItemId,
        warehouseId: data.warehouseId,
        warehouseBinId,
      },
    });

    if (!balance) {
      throw new NotFoundException(
        'Inventory balance not found for the selected warehouse and bin.',
      );
    }

    if (balance.quantityOnHand < data.quantity) {
      throw new BadRequestException(
        `Insufficient stock for ${inventory.productName}.`,
      );
    }

    const updatedOnHand =
      balance.quantityOnHand - data.quantity;

    const updatedAvailable =
      balance.quantityAvailable - data.quantity;

    if (updatedAvailable < 0) {
      throw new BadRequestException(
        `Insufficient available stock for ${inventory.productName}.`,
      );
    }

    const updatedBalance =
      await tx.inventoryBalance.update({
        where: {
          id: balance.id,
        },
        data: {
          quantityOnHand: updatedOnHand,
          quantityAvailable: updatedAvailable,
          updatedAt: new Date(),
        },
      });

    let updatedDispatchItem: Awaited<ReturnType<typeof tx.dispatchOrderItem.update>> | null = null;

    if (dispatchItem) {
      const remainingPackedQty =
        dispatchItem.packedQty - data.quantity;

      const updatedDispatchedQty =
        dispatchItem.dispatchedQty + data.quantity;

      updatedDispatchItem =
        await tx.dispatchOrderItem.update({
          where: {
            id: dispatchItem.id,
          },
          data: {
            packedQty: remainingPackedQty,
            dispatchedQty: updatedDispatchedQty,
            isPacked: remainingPackedQty > 0,
            isDispatched: updatedDispatchedQty > 0,
            remarks:
              data.remarks ?? dispatchItem.remarks,
          },
        });
    }

    const updatedStockQty =
      inventory.stockQty - data.quantity;

    const updatedAvailableQty =
      inventory.availableQty - data.quantity;

    if (updatedStockQty < 0 || updatedAvailableQty < 0) {
      throw new BadRequestException(
        `Insufficient aggregate inventory for ${inventory.productName}.`,
      );
    }

    const updatedInventory =
      await tx.inventoryItem.update({
        where: {
          id: inventory.id,
        },
        data: {
          stockQty: updatedStockQty,
          availableQty: updatedAvailableQty,
          updatedAt: new Date(),
        },
      });

    const transaction =
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.warehouseId,
          transactionType: 'ISSUE',
          referenceModule: data.referenceModule,
          referenceId: data.referenceId,
          quantity: -data.quantity,
          balanceAfter: updatedOnHand,
          remarks: data.remarks,
          createdBy: data.createdBy,
        },
      });

    const movement =
      await this.movementService.create(
        {
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.warehouseId,
          sourceBinId:
            warehouseBinId ?? undefined,
          batchId:
            balance.batchId ?? undefined,
          serialId:
            balance.serialId ?? undefined,
          movementType: 'ISSUE',
          movementStatus: 'POSTED',
          quantity: data.quantity,
          unitCost: balance.averageUnitCost,
          totalCost:
            balance.averageUnitCost *
            data.quantity,
          referenceModule: data.referenceModule,
          referenceId: data.referenceId,
          remarks: data.remarks,
          createdBy: data.createdBy,
        },
        tx,
      );

    return {
      success: true,
      message: 'Inventory issued successfully.',
      inventoryItem: updatedInventory,
      balance: updatedBalance,
      dispatchItem: updatedDispatchItem,
      transaction,
      movement,
    };
  }
}
