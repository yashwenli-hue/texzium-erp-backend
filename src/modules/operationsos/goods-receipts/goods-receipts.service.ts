import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateGoodsReceiptDto } from './dto/create-goods-receipt.dto';

@Injectable()
export class GoodsReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateGoodsReceiptDto) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: {
          id: data.purchaseOrderId,
        },
        include: {
          purchaseRequisition: true,
        },
      });

      if (!po) {
        throw new NotFoundException('Purchase Order not found.');
      }

      if (!po.purchaseRequisition) {
        throw new NotFoundException(
          'Purchase Requisition linked to Purchase Order not found.',
        );
      }

      if (data.receivedQty <= 0) {
        throw new BadRequestException(
          'Received quantity must be greater than zero.',
        );
      }

      const grn = await tx.goodsReceipt.create({
        data: {
          purchaseOrderId: data.purchaseOrderId,
          receivedQty: data.receivedQty,
          remarks: data.remarks,
        },
      });

      await tx.purchaseOrder.update({
        where: {
          id: po.id,
        },
        data: {
          status: 'RECEIVED',
        },
      });

      return grn;
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
