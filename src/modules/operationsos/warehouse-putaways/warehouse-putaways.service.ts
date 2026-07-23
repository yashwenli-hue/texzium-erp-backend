import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateWarehousePutawayDto } from './dto/create-warehouse-putaway.dto';

@Injectable()
export class WarehousePutawaysService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateWarehousePutawayDto) {
    const qc = await this.prisma.qualityInspection.findUnique({
      where: { id: data.qualityInspectionId },
    });

    if (!qc) {
      throw new Error('Quality Inspection not found');
    }

    if (data.putawayQty > qc.acceptedQty) {
      throw new Error('Putaway qty exceeds accepted qty');
    }

    return this.prisma.warehousePutaway.create({
      data: {
        qualityInspectionId: data.qualityInspectionId,
        inventoryItemId: data.inventoryItemId,
        warehouseName: data.warehouseName,
        zoneName: data.zoneName,
        rackNumber: data.rackNumber,
        binNumber: data.binNumber,
        putawayQty: data.putawayQty,
      },
    });
  }

  async findAll() {
    return this.prisma.warehousePutaway.findMany({
      include: {
        qualityInspection: true,
        inventoryItem: true,
      },
    });
  }
}
