import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateDispatchOrderItemDto } from './dto/create-dispatch-order-item.dto';

@Injectable()
export class DispatchOrderItemsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateDispatchOrderItemDto) {

    const dispatchOrder =
      await this.prisma.dispatchOrder.findUnique({
        where: {
          id: data.dispatchOrderId,
        },
      });

    if (!dispatchOrder) {
      throw new Error('Dispatch Order not found');
    }

    return this.prisma.dispatchOrderItem.create({
      data: {

        dispatchOrderId: data.dispatchOrderId,

        inventoryItemId: data.inventoryItemId,

        productCode: data.productCode,
        productName: data.productName,
        description: data.description,

        quantity: data.quantity,

        uom: data.uom,

        unitPrice: data.unitPrice,
        discountAmount: data.discountAmount,
        taxableAmount: data.taxableAmount,
        gstAmount: data.gstAmount,
        totalAmount: data.totalAmount,

        warehouseId: data.warehouseId,
        binLocation: data.binLocation,

        serialNumber: data.serialNumber,
        batchNumber: data.batchNumber,

        remarks: data.remarks,
      },
    });

  }

  async findAll() {

    return this.prisma.dispatchOrderItem.findMany({

      include: {

        dispatchOrder: true,

      },

      orderBy: {

        createdAt: 'desc',

      },

    });

  }

}
