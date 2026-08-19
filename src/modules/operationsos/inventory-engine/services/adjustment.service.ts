import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { AdjustmentInventoryDto } from '../dto/adjustment-inventory.dto';
import { MovementService } from './movement.service';
import { TraceabilityService } from './traceability.service';
import { InventoryLockService } from './inventory-lock.service';

@Injectable()
export class AdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
    private readonly traceabilityService: TraceabilityService,
    private readonly inventoryLockService: InventoryLockService,
  ) {}

  async execute(data: AdjustmentInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Adjustment quantity must be greater than zero.',
        );
      }

      await this.inventoryLockService.lockInventoryItem(
        tx,
        data.inventoryItemId,
      );

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

      const balance = await tx.inventoryBalance.findFirst({
        where: {
          inventoryItemId: data.inventoryItemId,
          warehouseId: data.warehouseId,
          warehouseBinId: data.warehouseBinId ?? null,
          batchId: data.batchId ?? null,
          serialId: data.serialId ?? null,
        },
      });

      await this.traceabilityService.validate(tx, {
         inventoryItemId: inventoryItem.id,
         batchId: data.batchId,
         serialId: data.serialId,
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

      const quantityDelta =
        data.adjustmentType === 'IN'
          ? data.quantity
          : -data.quantity;

      /*
       * ==========================================================
       * INVENTORY BALANCE
       * ==========================================================
       */

      let updatedBalance;

      if (balance) {
        const quantityOnHand =
          balance.quantityOnHand + quantityDelta;

        const quantityAvailable =
          balance.quantityAvailable + quantityDelta;

        if (
          quantityOnHand < 0 ||
          quantityAvailable < 0
        ) {
          throw new BadRequestException(
            'Adjustment would result in negative inventory.',
          );
        }

        updatedBalance =
          await tx.inventoryBalance.update({
            where: {
              id: balance.id,
            },
            data: {
              quantityOnHand,
              quantityAvailable,
              averageUnitCost:
                data.unitCost ??
                balance.averageUnitCost,
            },
          });
      } else {
        /*
         * A new balance can only be created for ADJUSTMENT_IN.
         * ADJUSTMENT_OUT without an existing balance was rejected above.
         */

        updatedBalance =
          await tx.inventoryBalance.create({
            data: {
              inventoryItemId:
                data.inventoryItemId,

              warehouseId:
                data.warehouseId,

              warehouseBinId:
                data.warehouseBinId,

              batchId:
                data.batchId,

              serialId:
                data.serialId,

              quantityOnHand:
                data.quantity,

              quantityReserved: 0,

              quantityAvailable:
                data.quantity,

              quantityBlocked: 0,

              quantityDamaged: 0,

              averageUnitCost:
                data.unitCost ?? 0,
            },
          });
      }

      /*
       * ==========================================================
       * INVENTORY ITEM AGGREGATE
       * ==========================================================
       *
       * Adjustment IN:
       *   stockQty      +Q
       *   availableQty  +Q
       *
       * Adjustment OUT:
       *   stockQty      -Q
       *   availableQty  -Q
       *
       * reservedQty remains unchanged.
       */

      const updatedStockQty =
        inventoryItem.stockQty +
        quantityDelta;

      const updatedAvailableQty =
        inventoryItem.availableQty +
        quantityDelta;

      if (
        updatedStockQty < 0 ||
        updatedAvailableQty < 0
      ) {
        throw new BadRequestException(
          'Adjustment would result in negative inventory item quantity.',
        );
      }

      const updatedInventoryItem =
        await tx.inventoryItem.update({
          where: {
            id: inventoryItem.id,
          },
          data: {
            stockQty:
              updatedStockQty,

            availableQty:
              updatedAvailableQty,

            updatedAt:
              new Date(),
          },
        });

      /*
       * ==========================================================
       * INVENTORY MOVEMENT
       * ==========================================================
       */

      const movementType =
        data.adjustmentType === 'IN'
          ? 'ADJUSTMENT_IN'
          : 'ADJUSTMENT_OUT';

      const movement =
        await this.movementService.create(
          {
            inventoryItemId:
              data.inventoryItemId,

            warehouseId:
              data.warehouseId,

            destinationBinId:
              data.adjustmentType === 'IN'
                ? data.warehouseBinId
                : undefined,

            sourceBinId:
              data.adjustmentType === 'OUT'
                ? data.warehouseBinId
                : undefined,

            batchId:
              data.batchId,

            serialId:
              data.serialId,

            movementType,

            movementStatus:
              'POSTED',

            quantity:
              data.quantity,

            unitCost:
              data.unitCost,

            totalCost:
              data.unitCost !== undefined
                ? data.unitCost *
                  data.quantity
                : undefined,

            referenceModule:
              'InventoryEngine',

            referenceId:
              data.inventoryItemId,

            remarks:
              data.remarks,

            createdBy:
              data.adjustedBy,
          },
          tx,
        );

      return {
        success: true,

        message:
          'Inventory adjusted successfully.',

        inventoryItem:
          updatedInventoryItem,

        balance:
          updatedBalance,

        movement,
      };
    });
  }
}
