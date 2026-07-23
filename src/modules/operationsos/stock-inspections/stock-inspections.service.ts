import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateStockInspectionDto } from './dto/create-stock-inspection.dto';

@Injectable()
export class StockInspectionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateStockInspectionDto) {
    return this.prisma.stockInspection.create({
      data: {
        inventoryItemId: data.inventoryItemId,
        salesOrderId: data.salesOrderId,
        inspectionDate: new Date(data.inspectionDate),
        conditionStatus: data.conditionStatus,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.stockInspection.findMany({
      include: {
        inventoryItem: true,
        salesOrder: true,
      },
    });
  }
}
