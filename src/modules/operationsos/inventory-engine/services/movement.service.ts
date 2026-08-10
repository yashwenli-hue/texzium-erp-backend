import { Injectable } from '@nestjs/common';
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
    const client = tx ?? this.prisma;

    return client.inventoryMovement.create({
      data: {
        inventoryItemId: data.inventoryItemId,

        warehouseId: data.warehouseId,

        sourceBinId: data.sourceBinId,
        destinationBinId: data.destinationBinId,

        batchId: data.batchId,
        serialId: data.serialId,

        movementType: data.movementType,
        movementStatus: data.movementStatus ?? 'POSTED',

        quantity: data.quantity,

        unitCost: data.unitCost,
        totalCost:
          data.totalCost ??
          (data.unitCost !== undefined
            ? data.unitCost * data.quantity
            : undefined),

        referenceModule: data.referenceModule,
        referenceId: data.referenceId,

        remarks: data.remarks,
        createdBy: data.createdBy,
      },
    });
  }
}
