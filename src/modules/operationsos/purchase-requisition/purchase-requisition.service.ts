import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';

@Injectable()
export class PurchaseRequisitionService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePurchaseRequisitionDto) {
    return this.prisma.purchaseRequisition.create({
      data: {
        salesOrderId: data.salesOrderId,
        inventoryItemId: data.inventoryItemId,
        requestedQty: data.requestedQty,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.purchaseRequisition.findMany({
      include: {
        salesOrder: true,
        inventoryItem: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
