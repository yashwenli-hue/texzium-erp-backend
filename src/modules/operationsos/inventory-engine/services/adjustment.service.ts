import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { AdjustmentInventoryDto } from '../dto/adjustment-inventory.dto';
import { MovementService } from './movement.service';

@Injectable()
export class AdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
  ) {}

  async execute(data: AdjustmentInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Adjustment quantity must be greater than zero.',
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

      const balance = await tx.inventoryBalance.findFirst({
        where: {
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.warehouseId,
          warehouseBinId: data.warehouseBinId ?? null,
          batchId: data.batchId ?? null,
          serialId: data.serialId ?? null,
        },
      });

      if (data.adjustmentType === 'OUT' && !balance) {
        throw new NotFoundException(
          'Inventory balance not found for adjustment.',
        );
      }

      if (
        data.adjustmentType === 'OUT' &&
        balance &&
        balance.quantityAvailable < data.quantity
      ) {
        throw new BadRequestException(
          'Insufficient available inventory for adjustment.',
        );
      }

      let updatedBalance;

      if (balance) {
        const quantityOnHand =
          data.adjustmentType === 'IN'
            ? balance.quantityOnHand + data.quantity
            : balance.quantityOnHand - data.quantity;

        const quantityAvailable =
          data.adjustmentType === 'IN'
            ? balance.quantityAvailable + data.quantity
            : balance.quantityAvailable - data.quantity;

        if (quantityOnHand < 0 || quantityAvailable < 0) {
          throw new BadRequestException(
            'Adjustment would result in negative inventory.',
          );
        }

        updatedBalance = await tx.inventoryBalance.update({
          where: {
            id: balance.id,
          },
          data: {
            quantityOnHand,
            quantityAvailable,

            averageUnitCost:
              data.unitCost ?? balance.averageUnitCost,
          },
        });
      } else {
        updatedBalance = await tx.inventoryBalance.create({
          data: {
            inventoryItemId: data.inventoryItemId,

            warehouseId: data.warehouseId,

            warehouseBinId: data.warehouseBinId,

            batchId: data.batchId,

            serialId: data.serialId,

            quantityOnHand: data.quantity,
            quantityReserved: 0,
            quantityAvailable: data.quantity,
            quantityBlocked: 0,
            quantityDamaged: 0,

            averageUnitCost: data.unitCost ?? 0,
          },
        });
      }

      const movementType =
        data.adjustmentType === 'IN'
          ? 'ADJUSTMENT_IN'
          : 'ADJUSTMENT_OUT';

      const movement =
        await this.movementService.create(
          {
            inventoryItemId: data.inventoryItemId,

            warehouseId: data.warehouseId,

            destinationBinId:
              data.adjustmentType === 'IN'
                ? data.warehouseBinId
                : undefined,

            sourceBinId:
              data.adjustmentType === 'OUT'
                ? data.warehouseBinId
                : undefined,

            batchId: data.batchId,
            serialId: data.serialId,

            movementType,
            movementStatus: 'POSTED',

            quantity: data.quantity,

            unitCost: data.unitCost,

            referenceModule: 'InventoryEngine',
            referenceId: data.inventoryItemId,

            remarks: data.remarks,
            createdBy: data.adjustedBy,
          },
          tx,
        );

      return {
        success: true,
        message: 'Inventory adjusted successfully.',
        balance: updatedBalance,
        movement,
      };
    });
  }
}

