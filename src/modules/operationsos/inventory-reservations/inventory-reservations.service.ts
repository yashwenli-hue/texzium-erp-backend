import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class InventoryReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.inventoryReservation.findMany({
      include: {
        inventoryItem: true,
        salesOrder: true,
      },
      orderBy: {
        expiryDate: 'asc',
      },
    });
  }
}
