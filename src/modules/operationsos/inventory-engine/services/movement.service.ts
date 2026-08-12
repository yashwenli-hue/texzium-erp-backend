import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../core/database/prisma.service';

export interface CreateInventoryMovementInput {
  inventoryItemId: string;

  warehouseId?: string;

  sourceBinId?: string;
  destinationBinId?: string;

  batchId?: string;
  serialId?: string;

  movementType: string;
  movementStatus?: string;

  quantity: number;

  unitCost?: number;
  totalCost?: number;

  referenceModule?: string;
  referenceId?: string;

  remarks?: string;
  createdBy?: string;
}

@Injectable()
export class MovementService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: CreateInventoryMovementInput,
    tx?: Prisma.TransactionClient,
  ) {
    if (!data.inventoryItemId?.trim()) {
      throw new BadRequestException(
        'Inventory Item is required for inventory movement.',
      );
    }

    if (!data.movementType?.trim()) {
      throw new BadRequestException(
        'Movement type is required.',
      );
    }

    if (!Number.isFinite(data.quantity) || data.quantity <= 0) {
      throw new BadRequestException(
        'Movement quantity must be greater than zero.',
      );
    }

    if (
      data.unitCost !== undefined &&
      (!Number.isFinite(data.unitCost) || data.unitCost < 0)
    ) {
      throw new BadRequestException(
        'Movement unit cost cannot be negative.',
      );
    }

    if (
      data.totalCost !== undefined &&
      (!Number.isFinite(data.totalCost) || data.totalCost < 0)
    ) {
      throw new BadRequestException(
        'Movement total cost cannot be negative.',
      );
    }

    const client = tx ?? this.prisma;

    const totalCost =
      data.totalCost ??
      (data.unitCost !== undefined
        ? data.unitCost * data.quantity
        : undefined);

    return client.inventoryMovement.create({
      data: {
        inventoryItemId: data.inventoryItemId,

        warehouseId: data.warehouseId,

        sourceBinId: data.sourceBinId,
        destinationBinId: data.destinationBinId,

        batchId: data.batchId,
        serialId: data.serialId,

        movementType: data.movementType,
        movementStatus:
          data.movementStatus ?? 'POSTED',

        quantity: data.quantity,

        unitCost: data.unitCost,
        totalCost,

        referenceModule: data.referenceModule,
        referenceId: data.referenceId,

        remarks: data.remarks,
        createdBy: data.createdBy,
      },
    });
  }
}
