import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';
import { MovementService } from './movement.service';
import { TraceabilityService } from './traceability.service';

export interface ConsumeInventoryInput {
  inventoryItemId: string;
  warehouseId: string;
  warehouseBinId?: string;
  batchId?: string;
  serialId?: string;
  quantity: number;
  unitCost: number;
  referenceModule: string;
  referenceId: string;
  remarks?: string;
  createdBy?: string;
}

@Injectable()
export class ConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
    private readonly traceabilityService: TraceabilityService,
  ) {}

  async consumeInventory(
    tx: Prisma.TransactionClient,
    data: ConsumeInventoryInput,
  ) {
    if (data.quantity <= 0) {
      throw new BadRequestException(
        'Consumption quantity must be greater than zero.',
      );
    }

    if (data.unitCost < 0) {
      throw new BadRequestException(
        'Consumption unit cost cannot be negative.',
      );
    }

    if (!data.warehouseId) {
      throw new BadRequestException(
        'Warehouse is required for inventory consumption.',
      );
    }

    const inventoryItem = await tx.inventoryItem.findUnique({
      where: {
        id: data.inventoryItemId,
      },
    });

    if (!inventoryItem) {
      throw new NotFoundException(
        'Inventory Item not found.',
      );
    }

    const warehouse = await tx.warehouse.findUnique({
      where: {
        id: data.warehouseId,
      },
    });

    if (!warehouse) {
      throw new NotFoundException(
        'Warehouse not found.',
      );
    }

    if (data.warehouseBinId) {
      const warehouseBin = await tx.warehouseBin.findFirst({
        where: {
          id: data.warehouseBinId,
          warehouseRack: {
            warehouseZone: {
              warehouseId: data.warehouseId,
            },
          },
        },
      });

      if (!warehouseBin) {
        throw new NotFoundException(
          'Warehouse Bin not found for the selected warehouse.',
        );
      }
    }

    await this.traceabilityService.validate(tx, {
      inventoryItemId: inventoryItem.id,
      batchId: data.batchId,
      serialId: data.serialId,
    });

    const balance = await tx.inventoryBalance.findFirst({
      where: {
        inventoryItemId: data.inventoryItemId,
        warehouseId: data.warehouseId,
        warehouseBinId: data.warehouseBinId ?? null,
        batchId: data.batchId ?? null,
        serialId: data.serialId ?? null,
      },
    });

    if (!balance) {
      throw new NotFoundException(
        'Inventory balance not found for the selected warehouse, bin and traceability.',
      );
    }

    if (balance.quantityAvailable < data.quantity) {
      throw new BadRequestException(
        `Insufficient available inventory for ${inventoryItem.productName}.`,
      );
    }

    if (balance.quantityOnHand < data.quantity) {
      throw new BadRequestException(
        `Insufficient on-hand inventory for ${inventoryItem.productName}.`,
      );
    }

    const updatedQuantityOnHand =
      balance.quantityOnHand - data.quantity;

    const updatedQuantityAvailable =
      balance.quantityAvailable - data.quantity;

    if (
      updatedQuantityOnHand < 0 ||
      updatedQuantityAvailable < 0
    ) {
      throw new BadRequestException(
        'Inventory consumption would result in invalid balance quantities.',
      );
    }

    const updatedBalance =
      await tx.inventoryBalance.update({
        where: {
          id: balance.id,
        },
        data: {
          quantityOnHand: updatedQuantityOnHand,
          quantityAvailable: updatedQuantityAvailable,
          updatedAt: new Date(),
        },
      });

    const updatedStockQty =
      inventoryItem.stockQty - data.quantity;

    const updatedAvailableQty =
      inventoryItem.availableQty - data.quantity;

    if (
      updatedStockQty < 0 ||
      updatedAvailableQty < 0
    ) {
      throw new BadRequestException(
        `Insufficient aggregate inventory for ${inventoryItem.productName}.`,
      );
    }

    const updatedInventory =
      await tx.inventoryItem.update({
        where: {
          id: inventoryItem.id,
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
          binLocation: data.warehouseBinId,
          transactionType: 'CONSUMPTION',
          referenceModule: data.referenceModule,
          referenceId: data.referenceId,
          quantity: -data.quantity,
          balanceAfter: updatedQuantityOnHand,
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
            data.warehouseBinId ?? undefined,
          batchId:
            data.batchId ?? undefined,
          serialId:
            data.serialId ?? undefined,
          movementType: 'CONSUMPTION',
          movementStatus: 'POSTED',
          quantity: data.quantity,
          unitCost: data.unitCost,
          totalCost:
            data.unitCost * data.quantity,
          referenceModule:
            data.referenceModule,
          referenceId:
            data.referenceId,
          remarks: data.remarks,
          createdBy: data.createdBy,
        },
        tx,
      );

    return {
      success: true,
      message: 'Inventory consumed successfully.',
      inventoryItem: updatedInventory,
      balance: updatedBalance,
      transaction,
      movement,
    };
  }
}
