import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { PackInventoryDto } from '../dto/pack-inventory.dto';
import { MovementService } from './movement.service';
import { TraceabilityService } from './traceability.service';

@Injectable()
export class PackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
    private readonly traceabilityService: TraceabilityService,
  ) {}

  async execute(data: PackInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Pack quantity must be greater than zero.',
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

      if (!dispatchItem.isPicked) {
        throw new BadRequestException(
          'Inventory has not been picked.',
        );
      }

      if (data.quantity > dispatchItem.pickedQty) {
        throw new BadRequestException(
          'Packed quantity exceeds picked quantity.',
        );
      }

      if (!dispatchItem.warehouseId) {
        throw new BadRequestException(
          'Dispatch Order Item does not have a warehouse assigned.',
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
  inventoryItemId: dispatchItem.inventoryItemId,
  batchId: balance.batchId,
  serialId: balance.serialId,
});

      const remainingPickedQty =
        dispatchItem.pickedQty -
        data.quantity;

      const updatedPackedQty =
        dispatchItem.packedQty +
        data.quantity;

      const updatedDispatchItem =
        await tx.dispatchOrderItem.update({
          where: {
            id: dispatchItem.id,
          },
          data: {
            pickedQty:
              remainingPickedQty,

            packedQty:
              updatedPackedQty,

            isPicked:
              remainingPickedQty > 0,

            isPacked:
              updatedPackedQty > 0,

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
              'PACK',

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
              data.packedBy,
          },
          tx,
        );

      return {
        success: true,

        message:
          'Inventory packed successfully.',

        dispatchItem:
          updatedDispatchItem,

        movement,
      };
    });
  }
}
