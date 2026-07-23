import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';

@Injectable()
export class GoodsReceiptService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateGoodsReceiptDto) {
    return this.prisma.goodsReceipt.create({
      data: {
        purchaseOrderId: data.purchaseOrderId,
        grnNumber: data.grnNumber,
        receivedQty: data.receivedQty,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.goodsReceipt.findMany({
      include: {
        purchaseOrder: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
