import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { ReleaseInventoryDto } from '../dto/release-inventory.dto';
import { MovementService } from './movement.service';

@Injectable()
export class ReleaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly movementService: MovementService,
  ) {}

  async execute(data: ReleaseInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      if (data.quantity <= 0) {
        throw new BadRequestException(
          'Release quantity must be greater than zero.',
        );
      }

      const dispatchItem = await tx.dispatchOrderItem.findUnique({
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

      if (dispatchItem.inventoryItemId !== data.inventoryItemId) {
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

      const balance = await tx.inventoryBalance.findFirst({
        where: {
          inventoryItemId: data.inventoryItemId,
          warehouseId: dispatchItem.warehouseId,
        },
      });

      if (!balance) {
        throw new NotFoundException(
          'Inventory balance not found for the assigned warehouse.',
        );
      }

      if (balance.quantityReserved < data.quantity) {
        throw new BadRequestException(
          'Inventory reserved quantity is less than the release quantity.',
        );
      }

      const newReservedQty =
        balance.quantityReserved - data.quantity;

      const newAvailableQty =
        balance.quantityAvailable + data.quantity;

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

      const remainingDispatchReservedQty =
        dispatchItem.reservedQty - data.quantity;

      const updatedDispatchItem =
        await tx.dispatchOrderItem.update({
          where: {
            id: dispatchItem.id,
          },
          data: {
            reservedQty: remainingDispatchReservedQty,
            isReserved:
              remainingDispatchReservedQty > 0,
          },
        });

      const movement =
        await this.movementService.create(
          {
            inventoryItemId: data.inventoryItemId,

            warehouseId: dispatchItem.warehouseId,

            sourceBinId:
              dispatchItem.binLocation ?? undefined,

            movementType: 'RELEASE',
            movementStatus: 'POSTED',

            quantity: data.quantity,

            referenceModule: 'DispatchOrder',
            referenceId: dispatchItem.dispatchOrderId,

            remarks: data.remarks,
            createdBy: data.releasedBy,
          },
          tx,
        );

      return {
        success: true,
        message: 'Inventory released successfully.',
        balance: updatedBalance,
        dispatchItem: updatedDispatchItem,
        movement,
      };
    });
  }
}
