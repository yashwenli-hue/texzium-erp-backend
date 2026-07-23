import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';

@Injectable()
export class GoodsReceiptsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateGoodsReceiptDto) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: data.purchaseOrderId },
      include: {
        purchaseRequisition: true,
      },
    });

    if (!po) {
      throw new Error('Purchase Order not found');
    }

    const grn = await this.prisma.goodsReceipt.create({
      data: {
        purchaseOrderId: data.purchaseOrderId,
        receivedQty: data.receivedQty,
        remarks: data.remarks,
      },
    });

    await this.prisma.inventoryItem.update({
      where: {
        id: po.purchaseRequisition.inventoryItemId,
      },
      data: {
  stockQty: {
    increment: data.receivedQty,
  },
  availableQty: {
    increment: data.receivedQty,
  },
},
    });

    await this.prisma.purchaseOrder.update({
      where: {
        id: po.id,
      },
      data: {
        status: 'RECEIVED',
      },
    });

    return grn;
  }

  async findAll() {
    return this.prisma.goodsReceipt.findMany({
      include: {
        purchaseOrder: true,
      },
    });
  }
}
