import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class ProfitLossService {
  constructor(private prisma: PrismaService) {}

  async getProfitLoss() {
    const salesInvoices =
      await this.prisma.salesInvoice.findMany();

    const vendorBills =
      await this.prisma.vendorBill.findMany();

    const payrolls =
      await this.prisma.payroll.findMany();

    const totalRevenue =
      salesInvoices.reduce(
        (sum, item) => sum + item.totalAmount,
        0,
      );

    const totalPurchaseCost =
      vendorBills.reduce(
        (sum, item) => sum + item.totalAmount,
        0,
      );

    const totalPayrollCost =
      payrolls.reduce(
        (sum, item) => sum + item.netSalary,
        0,
      );

    const totalExpenses =
      totalPurchaseCost + totalPayrollCost;

    const netProfit =
      totalRevenue - totalExpenses;

    const profitMargin =
      totalRevenue > 0
        ? ((netProfit / totalRevenue) * 100).toFixed(2)
        : '0';

    return {
      totalRevenue,
      totalPurchaseCost,
      totalPayrollCost,
      totalExpenses,
      netProfit,
      profitMargin: profitMargin + '%',
    };
  }
}
