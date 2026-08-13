import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

@Injectable()
export class TraceabilityService {
  /**
   * Validate batch / serial references against the Inventory Item.
   *
   * Rules:
   * 1. Batch must exist when supplied.
   * 2. Batch must belong to the Inventory Item.
   * 3. Serial must exist when supplied.
   * 4. Serial must belong to the Inventory Item.
   * 5. When both batch and serial are supplied,
   *    the serial must belong to that batch.
   */
  async validate(
    tx: Prisma.TransactionClient,
    data: {
      inventoryItemId: string;
      batchId?: string | null;
      serialId?: string | null;
    },
  ) {
    if (!data.inventoryItemId) {
      throw new BadRequestException(
        'Inventory Item is required for traceability validation.',
      );
    }

    if (data.batchId) {
      const batch = await tx.inventoryBatch.findUnique({
        where: {
          id: data.batchId,
        },
      });

      if (!batch) {
        throw new NotFoundException(
          'Inventory Batch not found.',
        );
      }

      if (
        batch.inventoryItemId !==
        data.inventoryItemId
      ) {
        throw new BadRequestException(
          'Inventory Batch does not belong to the selected Inventory Item.',
        );
      }
    }

    if (data.serialId) {
      const serial = await tx.inventorySerial.findUnique({
        where: {
          id: data.serialId,
        },
      });

      if (!serial) {
        throw new NotFoundException(
          'Inventory Serial not found.',
        );
      }

      if (
        serial.inventoryItemId !==
        data.inventoryItemId
      ) {
        throw new BadRequestException(
          'Inventory Serial does not belong to the selected Inventory Item.',
        );
      }

      if (
        data.batchId &&
        serial.batchId !== data.batchId
      ) {
        throw new BadRequestException(
          'Inventory Serial does not belong to the selected Inventory Batch.',
        );
      }
    }

    return true;
  }
}
