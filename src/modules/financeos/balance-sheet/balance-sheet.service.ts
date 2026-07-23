import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class BalanceSheetService {
  constructor(private prisma: PrismaService) {}

  async getBalanceSheet() {
    const receivables =
      await this.prisma.accountsReceivable.findMany();

    const payables =
      await this.prisma.accountsPayable.findMany();

    const inventory =
      await this.prisma.inventoryItem.findMany();

    const cashBalance = 500000;

    const totalReceivables =
      receivables.reduce(
        (sum, item) => sum + item.balanceAmount,
        0,
      );

    const totalPayables =
      payables.reduce(
        (sum, item) => sum + item.balanceAmount,
        0,
      );

    const inventoryValue =
      inventory.reduce(
        (sum, item) =>
          sum + item.stockQty * 1000,
        0,
      );

    const totalAssets =
      cashBalance +
      totalReceivables +
      inventoryValue;

    const totalLiabilities =
      totalPayables;

    const netWorth =
      totalAssets - totalLiabilities;

    return {
      cashBalance,
      totalReceivables,
      inventoryValue,
      totalAssets,
      totalPayables,
      totalLiabilities,
      netWorth,
    };
  }
}
