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

    const warehouseId = data.warehouseId;

    if (!warehouseId) {
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
      dispatchItem.inventoryItemId &&
      dispatchItem.inventoryItemId !==
        data.inventoryItemId
    ) {
      throw new BadRequestException(
        'Dispatch Order Item does not match the Inventory Item.',
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
              warehouseId,
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

    const balance =
      await tx.inventoryBalance.findFirst({
        where: {
          inventoryItemId:
            data.inventoryItemId,

          warehouseId,

          warehouseBinId,
        },
      });

    if (!balance) {
      throw new NotFoundException(
        'Inventory balance not found for the selected warehouse and bin.',
      );
    }

    if (
      balance.quantityOnHand <
      data.quantity
    ) {
      throw new BadRequestException(
        `Insufficient stock for ${inventory.productName}.`,
      );
    }

    if (
      balance.quantityReserved <
      data.quantity
    ) {
      throw new BadRequestException(
        `Reserved quantity is less than issue quantity for ${inventory.productName}.`,
      );
    }

    const updatedOnHand =
      balance.quantityOnHand -
      data.quantity;

    const updatedReserved =
      balance.quantityReserved -
      data.quantity;

    const updatedBalance =
      await tx.inventoryBalance.update({
        where: {
          id: balance.id,
        },
        data: {
          quantityOnHand:
            updatedOnHand,

          quantityReserved:
            updatedReserved,

          quantityAvailable:
            balance.quantityAvailable,

          updatedAt: new Date(),
        },
      });

    const updatedDispatchItem =
      dispatchItem
        ? await tx.dispatchOrderItem.update({
            where: {
              id: dispatchItem.id,
            },
            data: {
              dispatchedQty:
                dispatchItem.dispatchedQty +
                data.quantity,

              isDispatched: true,

              remarks:
                data.remarks ??
                dispatchItem.remarks,
            },
          })
        : null;

    const transaction =
      await tx.inventoryTransaction.create({
        data: {
          inventoryItemId:
            data.inventoryItemId,

          warehouseId,

          transactionType:
            'ISSUE',

          referenceModule:
            data.referenceModule,

          referenceId:
            data.referenceId,

          quantity:
            -data.quantity,

          balanceAfter:
            updatedOnHand,

          remarks:
            data.remarks,

          createdBy:
            data.createdBy,
        },
      });

    const movement =
      await this.movementService.create(
        {
          inventoryItemId:
            data.inventoryItemId,

          warehouseId,

          sourceBinId:
            warehouseBinId ??
            undefined,

          movementType:
            'ISSUE',

          movementStatus:
            'POSTED',

          quantity:
            data.quantity,

          unitCost:
            balance.averageUnitCost,

          totalCost:
            balance.averageUnitCost *
            data.quantity,

          referenceModule:
            data.referenceModule,

          referenceId:
            data.referenceId,

          remarks:
            data.remarks,

          createdBy:
            data.createdBy,
        },
        tx,
      );

    return {
      success: true,

      message:
        'Inventory issued successfully.',

      inventoryItem: inventory,

      balance:
        updatedBalance,

      dispatchItem:
        updatedDispatchItem,

      transaction,

      movement,
    };
  }
}
