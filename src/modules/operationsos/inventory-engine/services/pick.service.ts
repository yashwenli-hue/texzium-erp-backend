import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { PickInventoryDto } from '../dto/pick-inventory.dto';

@Injectable()
export class PickService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(data: PickInventoryDto) {
    return this.prisma.$transaction(async (tx) => {

      const dispatchItem = await tx.dispatchOrderItem.findUnique({
        where: {
          id: data.dispatchOrderItemId,
        },
      });

      if (!dispatchItem) {
        throw new Error('Dispatch Item not found');
      }

      if (!dispatchItem.isReserved) {
        throw new Error('Inventory not reserved');
      }

      if (data.quantity > dispatchItem.reservedQty) {
        throw new Error('Picked quantity exceeds reserved quantity');
      }

      const updatedItem = await tx.dispatchOrderItem.update({
        where: {
          id: dispatchItem.id,
        },
        data: {
          pickedQty: dispatchItem.pickedQty + data.quantity,
          isPicked: true,
        },
      });

      return {
        success: true,
        message: 'Inventory picked successfully.',
        dispatchItem: updatedItem,
      };
    });
  }
}
