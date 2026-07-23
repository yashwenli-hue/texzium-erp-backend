import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class InventoryReportsService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const items =
      await this.prisma.inventoryItem.findMany();

    const totalStock =
      items.reduce((sum, item) => sum + item.stockQty, 0);

    const totalReserved =
      items.reduce((sum, item) => sum + item.reservedQty, 0);

    const totalAvailable =
      items.reduce((sum, item) => sum + item.availableQty, 0);

    return {
      totalItems: items.length,
      totalStock,
      totalReserved,
      totalAvailable,
    };
  }

  async lowStock() {
    return this.prisma.inventoryItem.findMany({
      where: {
        availableQty: {
          lte: 10,
        },
      },
      orderBy: {
        availableQty: 'asc',
      },
    });
  }

  async deadStock() {
    return this.prisma.inventoryItem.findMany({
      where: {
        stockQty: {
          gt: 0,
        },
        reservedQty: 0,
      },
    });
  }

  async fastMoving() {
    return this.prisma.salesInvoiceItem.groupBy({
      by: ['productId'],
      _sum: {
        quantity: true,
      },
      orderBy: {
        _sum: {
          quantity: 'desc',
        },
      },
      take: 10,
    });
  }
  
  async slowMoving() {
  return this.prisma.salesInvoiceItem.groupBy({
    by: ['productId'],
    _sum: {
      quantity: true,
    },
    orderBy: {
      _sum: {
        quantity: 'asc',
      },
    },
    take: 10,
  });
}

async warehouseUtilization() {
  return this.prisma.inventoryItem.groupBy({
    by: ['warehouse'],
    _sum: {
      stockQty: true,
    },
  });
}

async stockAging() {
  const items =
    await this.prisma.inventoryItem.findMany();

  const today = new Date();

  return items.map((item) => {
    const ageDays =
      Math.floor(
        (today.getTime() - item.createdAt.getTime()) /
        (1000 * 60 * 60 * 24),
      );

    return {
      sku: item.sku,
      productName: item.productName,
      stockQty: item.stockQty,
      ageDays,
    };
  });
}

async reorderAlerts() {
  return this.prisma.inventoryItem.findMany({
    where: {
      availableQty: {
        lte: 5,
      },
    },
    orderBy: {
      availableQty: 'asc',
    },
  });
}

}
