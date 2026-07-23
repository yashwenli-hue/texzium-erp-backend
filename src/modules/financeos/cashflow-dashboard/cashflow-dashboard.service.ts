import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class CashflowDashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const receivables =
      await this.prisma.accountsReceivable.findMany();

    const payables =
      await this.prisma.accountsPayable.findMany();

    const refunds =
      await this.prisma.refundVoucher.findMany();

    const totalInflow =
      receivables.reduce(
        (sum, item) => sum + item.paidAmount,
        0,
      );

    const totalOutflow =
      payables.reduce(
        (sum, item) => sum + item.paidAmount,
        0,
      );

    const totalRefunds =
      refunds.reduce(
        (sum, item) => sum + item.refundAmount,
        0,
      );

    const netCashPosition =
      totalInflow - totalOutflow - totalRefunds;

    return {
      totalInflow,
      totalOutflow,
      totalRefunds,
      netCashPosition,
    };
  }
}
