import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class ProfitabilityDashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const sales =
      await this.prisma.salesInvoiceItem.findMany();

    const refunds =
      await this.prisma.refundVoucher.findMany();

    const badDebts =
      await this.prisma.badDebtWriteOff.findMany();

    const revenue =
      sales.reduce(
        (sum, item) => sum + item.totalAmount,
        0,
      );

    const cogs =
      sales.reduce(
        (sum, item) => sum + (item.taxableAmount * 0.70),
        0,
      );

    const grossProfit =
      revenue - cogs;

    const refundLoss =
      refunds.reduce(
        (sum, item) => sum + item.refundAmount,
        0,
      );

    const badDebtLoss =
      badDebts.reduce(
        (sum, item) => sum + item.writeOffAmount,
        0,
      );

    const netProfit =
      grossProfit - refundLoss - badDebtLoss;

    const profitMargin =
      revenue > 0
        ? (netProfit / revenue) * 100
        : 0;

    return {
      revenue,
      cogs,
      grossProfit,
      refundLoss,
      badDebtLoss,
      netProfit,
      profitMargin: profitMargin.toFixed(2) + '%',
    };
  }
}
