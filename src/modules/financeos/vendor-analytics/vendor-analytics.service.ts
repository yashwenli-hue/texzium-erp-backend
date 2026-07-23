import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class VendorAnalyticsService {
  constructor(private prisma: PrismaService) {}

  async costSummary() {
    const bills =
      await this.prisma.vendorBill.findMany();

    const totalPurchaseValue =
      bills.reduce(
        (sum, item) => sum + item.totalAmount,
        0,
      );

    return {
      totalBills: bills.length,
      totalPurchaseValue,
    };
  }

  async vendorRanking() {
    return this.prisma.vendorBill.groupBy({
      by: ['vendorName'],
      _sum: {
        totalAmount: true,
      },
      orderBy: {
        _sum: {
          totalAmount: 'desc',
        },
      },
    });
  }

  async paymentExposure() {
    return this.prisma.accountsPayable.groupBy({
      by: ['vendorName'],
      _sum: {
        balanceAmount: true,
      },
      orderBy: {
        _sum: {
          balanceAmount: 'desc',
        },
      },
    });
  }
}
