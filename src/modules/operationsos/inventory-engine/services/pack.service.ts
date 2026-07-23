import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../core/database/prisma.service';
import { PackInventoryDto } from '../dto/pack-inventory.dto';

@Injectable()
export class PackService {
  constructor(private readonly prisma: PrismaService) {}

  async execute(data: PackInventoryDto) {
    return this.prisma.$transaction(async (tx) => {

      const dispatchItem = await tx.dispatchOrderItem.findUnique({
        where: {
          id: data.dispatchOrderItemId,
        },
      });

      if (!dispatchItem) {
        throw new Error('Dispatch Item not found');
      }

      if (!dispatchItem.isPicked) {
        throw new Error('Item has not been picked');
      }

      if (data.quantity > dispatchItem.pickedQty) {
        throw new Error('Packed quantity exceeds picked quantity');
      }

      const updatedItem = await tx.dispatchOrderItem.update({
        where: {
          id: dispatchItem.id,
        },
        data: {
          packedQty: dispatchItem.packedQty + data.quantity,
          isPacked: true,
        },
      });

      return {
        success: true,
        message: 'Inventory packed successfully.',
        dispatchItem: updatedItem,
      };
    });
  }
}
