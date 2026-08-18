import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { PickInventoryDto } from '../dto/pick-inventory.dto';
import { MovementService } from './movement.service';
import { TraceabilityService } from './traceability.service';
import { InventoryLockService } from './inventory-lock.service';

@Injectable()
export class PickService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
    private readonly traceabilityService: TraceabilityService,
    private readonly inventoryLockService: InventoryLockService,
  ) {}

  async execute(data: PickInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Pick quantity must be greater than zero.',
        );
      }

      const initialDispatchItem =
        await tx.dispatchOrderItem.findUnique({
          where: {
            id: data.dispatchOrderItemId,
          },
        });

      if (!initialDispatchItem) {
        throw new NotFoundException(
          'Dispatch Order Item not found.',
        );
      }

      if (!initialDispatchItem.inventoryItemId) {
        throw new BadRequestException(
          'Dispatch Order Item is not linked to an Inventory Item.',
        );
      }

      await this.inventoryLockService.lockInventoryItem(
        tx,
        initialDispatchItem.inventoryItemId,
      );

      await this.inventoryLockService.lockDispatchOrderItem(
        tx,
        data.dispatchOrderItemId,
      );

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

      if (!dispatchItem.isReserved) {
        throw new BadRequestException(
          'Inventory is not reserved.',
        );
      }

      if (data.quantity > dispatchItem.reservedQty) {
        throw new BadRequestException(
          'Picked quantity exceeds reserved quantity.',
        );
      }

      if (!dispatchItem.warehouseId) {
        throw new BadRequestException(
          'Dispatch Order Item does not have a warehouse assigned.',
        );
      }

      const inventory = await tx.inventoryItem.findUnique({
        where: {
          id: dispatchItem.inventoryItemId,
        },
      });

      if (!inventory) {
        throw new NotFoundException(
          'Inventory Item not found.',
        );
      }

      let warehouseBinId: string | null = null;

      if (dispatchItem.binLocation) {
        const bin = await tx.warehouseBin.findFirst({
          where: {
            code: dispatchItem.binLocation,
            warehouseRack: {
              warehouseZone: {
                warehouseId: dispatchItem.warehouseId,
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
              dispatchItem.inventoryItemId,

            warehouseId:
              dispatchItem.warehouseId,

            warehouseBinId,
          },
        });

      if (!balance) {
        throw new NotFoundException(
          'Inventory balance not found for the selected warehouse and bin.',
        );
      }

      await this.traceabilityService.validate(tx, {
        inventoryItemId: inventory.id,
        batchId: balance.batchId,
        serialId: balance.serialId,
      });

      if (
        balance.quantityReserved < data.quantity
      ) {
        throw new BadRequestException(
          'Inventory reserved quantity is less than the pick quantity.',
        );
      }

      if (
        inventory.reservedQty < data.quantity
      ) {
        throw new BadRequestException(
          'Aggregate inventory reserved quantity is less than the pick quantity.',
        );
      }

      const newReservedQty =
        balance.quantityReserved -
        data.quantity;

      const newInventoryReservedQty =
        inventory.reservedQty -
        data.quantity;

      if (newInventoryReservedQty < 0) {
        throw new BadRequestException(
          'Picking would result in invalid aggregate inventory quantities.',
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
          },
        });

      const updatedInventory =
        await tx.inventoryItem.update({
          where: {
            id: inventory.id,
          },
          data: {
            reservedQty:
              newInventoryReservedQty,

            updatedAt: new Date(),
          },
        });

      const remainingReservedQty =
        dispatchItem.reservedQty -
        data.quantity;

      const updatedPickedQty =
        dispatchItem.pickedQty +
        data.quantity;

      const updatedDispatchItem =
        await tx.dispatchOrderItem.update({
          where: {
            id: dispatchItem.id,
          },
          data: {
            reservedQty:
              remainingReservedQty,

            pickedQty:
              updatedPickedQty,

            isReserved:
              remainingReservedQty > 0,

            isPicked:
              updatedPickedQty > 0,

            remarks:
              data.remarks ??
              dispatchItem.remarks,
          },
        });

      const movement =
        await this.movementService.create(
          {
            inventoryItemId:
              dispatchItem.inventoryItemId,

            warehouseId:
              dispatchItem.warehouseId,

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
              'PICK',

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
              data.pickedBy,
          },
          tx,
        );

      return {
        success: true,

        message:
          'Inventory picked successfully.',

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
