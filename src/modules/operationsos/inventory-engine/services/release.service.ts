import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { ReleaseInventoryDto } from '../dto/release-inventory.dto';
import { MovementService } from './movement.service';
import { TraceabilityService } from './traceability.service';
import { InventoryLockService } from './inventory-lock.service';


@Injectable()
export class ReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
    private readonly traceabilityService: TraceabilityService,
    private readonly inventoryLockService: InventoryLockService,
  ) {}

  async execute(data: ReleaseInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Release quantity must be greater than zero.',
        );
      }

      await this.inventoryLockService.lockInventoryItem(
        tx,
        data.inventoryItemId,
      );

      await this.inventoryLockService.lockDispatchOrderItem(
        tx,
        data.dispatchOrderItemId,
      );

      const inventoryItem =
        await tx.inventoryItem.findUnique({
          where: {
            id: data.inventoryItemId,
          },
        });

      if (!inventoryItem) {
        throw new NotFoundException(
          'Inventory Item not found.',
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

      if (!dispatchItem.inventoryItemId) {
        throw new BadRequestException(
          'Dispatch Order Item is not linked to an Inventory Item.',
        );
      }

      if (
        dispatchItem.inventoryItemId !==
        data.inventoryItemId
      ) {
        throw new BadRequestException(
          'Inventory Item does not match the Dispatch Order Item.',
        );
      }

      if (!dispatchItem.isReserved) {
        throw new BadRequestException(
          'Dispatch Order Item is not reserved.',
        );
      }

      if (data.quantity > dispatchItem.reservedQty) {
        throw new BadRequestException(
          'Release quantity exceeds reserved quantity.',
        );
      }

      if (!dispatchItem.warehouseId) {
        throw new BadRequestException(
          'Dispatch Order Item does not have a warehouse assigned.',
        );
      }

      let warehouseBinId: string | null = null;

      if (dispatchItem.binLocation) {
        const bin =
          await tx.warehouseBin.findFirst({
            where: {
              code: dispatchItem.binLocation,
              warehouseRack: {
                warehouseZone: {
                  warehouseId:
                    dispatchItem.warehouseId,
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

            warehouseId:
              dispatchItem.warehouseId,

            warehouseBinId,
          },
        });

      if (!balance) {
        throw new NotFoundException(
          'Inventory balance not found for the assigned warehouse and bin.',
        );
      }

      await this.traceabilityService.validate(tx, {
  inventoryItemId: inventoryItem.id,
  batchId: balance.batchId,
  serialId: balance.serialId,
});

      if (
        balance.quantityReserved <
        data.quantity
      ) {
        throw new BadRequestException(
          'Inventory reserved quantity is less than the release quantity.',
        );
      }

      const newReservedQty =
        balance.quantityReserved -
        data.quantity;

      const newAvailableQty =
        balance.quantityAvailable +
        data.quantity;

      const newInventoryReservedQty =
        inventoryItem.reservedQty -
        data.quantity;

      const newInventoryAvailableQty =
        inventoryItem.availableQty +
        data.quantity;

      if (newInventoryReservedQty < 0) {
        throw new BadRequestException(
          'Inventory aggregate reserved quantity cannot become negative.',
        );
      }

      const updatedBalance =
        await tx.inventoryBalance.update({
          where: {
            id: balance.id,
          },
          data: {
            quantityReserved:
              newReservedQty,

            quantityAvailable:
              newAvailableQty,

            updatedAt:
              new Date(),
          },
        });

      const updatedInventory =
        await tx.inventoryItem.update({
          where: {
            id: inventoryItem.id,
          },
          data: {
            reservedQty:
              newInventoryReservedQty,

            availableQty:
              newInventoryAvailableQty,

            updatedAt:
              new Date(),
          },
        });

      const remainingDispatchReservedQty =
        dispatchItem.reservedQty -
        data.quantity;

      const updatedDispatchItem =
        await tx.dispatchOrderItem.update({
          where: {
            id: dispatchItem.id,
          },
          data: {
            reservedQty:
              remainingDispatchReservedQty,

            isReserved:
              remainingDispatchReservedQty > 0,

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
              dispatchItem.warehouseId,

            sourceBinId:
              warehouseBinId ??
              undefined,

            movementType:
              'RELEASE',

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
              data.releasedBy,
          },
          tx,
        );

      return {
        success: true,

        message:
          'Inventory released successfully.',

        inventoryItem:
          updatedInventory,

        balance:
          updatedBalance,

        dispatchItem:
          updatedDispatchItem,

        movement,
      };
    });
  }
}
