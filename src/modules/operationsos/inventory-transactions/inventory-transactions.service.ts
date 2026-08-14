import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class InventoryTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.inventoryTransaction.findMany({
      include: {
        inventoryItem: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
