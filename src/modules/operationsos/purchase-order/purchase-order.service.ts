import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

@Injectable()
export class PurchaseOrderService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePurchaseOrderDto) {
    return this.prisma.purchaseOrder.create({
      data: {
        purchaseRequisitionId: data.purchaseRequisitionId,
        poNumber: data.poNumber,
        orderQty: data.orderQty,
      },
    });
  }

  async findAll() {
    return this.prisma.purchaseOrder.findMany({
      include: {
        purchaseRequisition: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
