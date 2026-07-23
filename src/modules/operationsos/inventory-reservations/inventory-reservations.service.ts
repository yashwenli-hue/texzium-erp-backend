import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateInventoryReservationDto } from './dto/create-inventory-reservation.dto';

@Injectable()
export class InventoryReservationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateInventoryReservationDto) {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
    });

    if (!item) {
      throw new BadRequestException('Inventory item not found');
    }

    if (item.availableQty < data.quantity) {
      throw new BadRequestException('Insufficient stock available');
    }

    await this.prisma.inventoryItem.update({
      where: { id: data.inventoryItemId },
      data: {
        availableQty: item.availableQty - data.quantity,
        reservedQty: item.reservedQty + data.quantity,
      },
    });

    return this.prisma.inventoryReservation.create({
      data: {
        inventoryItemId: data.inventoryItemId,
        salesOrderId: data.salesOrderId,
        quantity: data.quantity,
        reservedById: data.reservedById,
        reservationType: data.reservationType || 'SALES_ORDER',
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        priorityLevel: data.priorityLevel || 'NORMAL',
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.inventoryReservation.findMany({
      include: {
        inventoryItem: true,
        salesOrder: true,
      },
    });
  }
}
