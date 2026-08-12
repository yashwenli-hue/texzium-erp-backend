import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { ReserveInventoryDto } from '../dto/reserve-inventory.dto';
import { MovementService } from './movement.service';

@Injectable()
export class ReserveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
  ) {}

  async execute(data: ReserveInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Reservation quantity must be greater than zero.',
        );
      }

      if (!data.warehouseId) {
        throw new BadRequestException(
          'Warehouse is required for inventory reservation.',
        );
      }

      const dispatchItem =
        await tx.dispatchOrderItem.findUnique({
          where: {
            id: data.dispatchOrderItemId,
          },
        });

      if (!dispatchItem) {
        throw new NotFoundException(
          'Dispatch Order Item not found.',
        );
      }

      if (
        dispatchItem.inventoryItemId &&
        dispatchItem.inventoryItemId !== data.inventoryItemId
      ) {
        throw new BadRequestException(
          'Inventory Item does not match the Dispatch Order Item.',
        );
      }

      /*
       * Resolve the warehouse bin from the request when supplied.
       * Otherwise inherit the bin location already assigned to
       * the Dispatch Order Item.
       */
      const effectiveBinLocation =
        data.binLocation ??
        dispatchItem.binLocation ??
        undefined;

      let warehouseBinId: string | null = null;

      if (effectiveBinLocation) {
        const bin = await tx.warehouseBin.findFirst({
          where: {
            code: effectiveBinLocation,
            warehouseRack: {
              warehouseZone: {
                warehouseId: data.warehouseId,
              },
            },
          },
        });

        if (!bin) {
          throw new NotFoundException(
            'Warehouse bin not found for the selected warehouse.',
          );
        }

        warehouseBinId = bin.id;
      }

      const balance =
        await tx.inventoryBalance.findFirst({
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

      if (
        balance.quantityAvailable < data.quantity
      ) {
        throw new BadRequestException(
          'Insufficient available inventory.',
        );
      }

      const newReservedQty =
        balance.quantityReserved + data.quantity;

      const newAvailableQty =
        balance.quantityAvailable - data.quantity;

      const updatedBalance =
        await tx.inventoryBalance.update({
          where: {
            id: balance.id,
          },
          data: {
            quantityReserved: newReservedQty,
            quantityAvailable: newAvailableQty,
          },
        });

      const updatedDispatchItem =
        await tx.dispatchOrderItem.update({
          where: {
            id: dispatchItem.id,
          },
          data: {
            inventoryItemId:
              data.inventoryItemId,

            reservedQty:
              dispatchItem.reservedQty +
              data.quantity,

            isReserved: true,

            warehouseId:
              data.warehouseId,

            binLocation:
              effectiveBinLocation,

            remarks:
              data.remarks ??
              dispatchItem.remarks,
          },
        });

      const movement =
        await this.movementService.create(
          {
            inventoryItemId:
              data.inventoryItemId,

            warehouseId:
              data.warehouseId,

            sourceBinId:
              warehouseBinId ??
              undefined,

            batchId:
              balance.batchId ??
              undefined,

            serialId:
              balance.serialId ??
              undefined,

            movementType:
              'RESERVATION',

            movementStatus:
              'POSTED',

            quantity:
              data.quantity,

            referenceModule:
              'DispatchOrder',

            referenceId:
              dispatchItem.dispatchOrderId,

            remarks:
              data.remarks,

            createdBy:
              data.reservedBy,
          },
          tx,
        );

      return {
        success: true,

        message:
          'Inventory reserved successfully.',

        balance:
          updatedBalance,

        dispatchItem:
          updatedDispatchItem,

        movement,
      };
    });
  }
}
