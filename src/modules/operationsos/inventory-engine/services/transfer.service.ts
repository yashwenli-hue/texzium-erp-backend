import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { TransferInventoryDto } from '../dto/transfer-inventory.dto';
import { MovementService } from './movement.service';

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
  ) {}

  async execute(data: TransferInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Transfer quantity must be greater than zero.',
        );
      }

      if (
        data.sourceWarehouseId === data.destinationWarehouseId &&
        data.sourceBinId === data.destinationBinId
      ) {
        throw new BadRequestException(
          'Source and destination cannot be the same location.',
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

      const sourceWarehouse = await tx.warehouse.findUnique({
        where: {
          id: data.sourceWarehouseId,
        },
      });

      if (!sourceWarehouse) {
        throw new NotFoundException(
          'Source warehouse not found.',
        );
      }

      const destinationWarehouse =
        await tx.warehouse.findUnique({
          where: {
            id: data.destinationWarehouseId,
          },
        });

      if (!destinationWarehouse) {
        throw new NotFoundException(
          'Destination warehouse not found.',
        );
      }

      /*
       * Validate source bin when supplied.
       */
      if (data.sourceBinId) {
        const sourceBin = await tx.warehouseBin.findFirst({
          where: {
            id: data.sourceBinId,
            warehouseRack: {
              warehouseZone: {
                warehouseId: data.sourceWarehouseId,
              },
            },
          },
        });

        if (!sourceBin) {
          throw new NotFoundException(
            'Source warehouse bin not found for the source warehouse.',
          );
        }
      }

      /*
       * Validate destination bin when supplied.
       */
      if (data.destinationBinId) {
        const destinationBin =
          await tx.warehouseBin.findFirst({
            where: {
              id: data.destinationBinId,
              warehouseRack: {
                warehouseZone: {
                  warehouseId:
                    data.destinationWarehouseId,
                },
              },
            },
          });

        if (!destinationBin) {
          throw new NotFoundException(
            'Destination warehouse bin not found for the destination warehouse.',
          );
        }
      }


      const sourceBalance =
        await tx.inventoryBalance.findFirst({
          where: {
            inventoryItemId:
              data.inventoryItemId,

            warehouseId:
              data.sourceWarehouseId,

            warehouseBinId:
              data.sourceBinId ?? null,

            batchId:
              data.batchId ?? null,

            serialId:
              data.serialId ?? null,
          },
        });

      if (!sourceBalance) {
        throw new NotFoundException(
          'Source inventory balance not found.',
        );
      }

      if (
        sourceBalance.quantityAvailable <
        data.quantity
      ) {
        throw new BadRequestException(
          'Insufficient available inventory at source location.',
        );
      }

      const sourceQuantityOnHand =
        sourceBalance.quantityOnHand -
        data.quantity;

      const sourceQuantityAvailable =
        sourceBalance.quantityAvailable -
        data.quantity;

      if (
        sourceQuantityOnHand < 0 ||
        sourceQuantityAvailable < 0
      ) {
        throw new BadRequestException(
          'Transfer would result in negative source inventory.',
        );
      }

      const updatedSourceBalance =
        await tx.inventoryBalance.update({
          where: {
            id: sourceBalance.id,
          },
          data: {
            quantityOnHand:
              sourceQuantityOnHand,

            quantityAvailable:
              sourceQuantityAvailable,
          },
        });

      const destinationBalance =
        await tx.inventoryBalance.findFirst({
          where: {
            inventoryItemId:
              data.inventoryItemId,

            warehouseId:
              data.destinationWarehouseId,

            warehouseBinId:
              data.destinationBinId ?? null,

            batchId:
              data.batchId ?? null,

            serialId:
              data.serialId ?? null,
          },
        });

      let updatedDestinationBalance;

      if (destinationBalance) {
        updatedDestinationBalance =
          await tx.inventoryBalance.update({
            where: {
              id: destinationBalance.id,
            },
            data: {
              quantityOnHand:
                destinationBalance.quantityOnHand +
                data.quantity,

              quantityAvailable:
                destinationBalance.quantityAvailable +
                data.quantity,

              averageUnitCost:
                data.unitCost ??
                destinationBalance.averageUnitCost,
            },
          });
      } else {
        updatedDestinationBalance =
          await tx.inventoryBalance.create({
            data: {
              inventoryItemId:
                data.inventoryItemId,

              warehouseId:
                data.destinationWarehouseId,

              warehouseBinId:
                data.destinationBinId,

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
                data.unitCost ??
                sourceBalance.averageUnitCost,
            },
          });
      }

      /*
       * For an internal transfer, aggregate InventoryItem
       * quantities do not change. Stock merely moves between
       * warehouse/bin balances.
       */

      const movementUnitCost =
        data.unitCost ??
        sourceBalance.averageUnitCost;

      const movement =
        await this.movementService.create(
          {
            inventoryItemId:
              data.inventoryItemId,

            warehouseId:
              data.destinationWarehouseId,

            sourceBinId:
              data.sourceBinId,

            destinationBinId:
              data.destinationBinId,

            batchId:
              data.batchId,

            serialId:
              data.serialId,

            movementType:
              'TRANSFER',

            movementStatus:
              'POSTED',

            quantity:
              data.quantity,

            unitCost:
              movementUnitCost,

            totalCost:
              movementUnitCost *
              data.quantity,

            referenceModule:
              'InventoryEngine',

            referenceId:
              data.inventoryItemId,

            remarks:
              data.remarks,

            createdBy:
              data.transferredBy,
          },
          tx,
        );

      return {
        success: true,

        message:
          'Inventory transferred successfully.',

        sourceBalance:
          updatedSourceBalance,

        destinationBalance:
          updatedDestinationBalance,

        movement,
      };
    });
  }
}
