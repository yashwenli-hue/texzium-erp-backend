import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class ForecastingEngineService {
  constructor(private prisma: PrismaService) {}

  async forecast() {
    const salesInvoices =
      await this.prisma.salesInvoice.findMany();

    const payrolls =
      await this.prisma.payroll.findMany();

    const projectBillings =
      await this.prisma.projectBilling.findMany();

    const totalSales =
      salesInvoices.reduce(
        (sum, item) => sum + item.totalAmount,
        0,
      );

    const totalPayroll =
      payrolls.reduce(
        (sum, item) => sum + item.netSalary,
        0,
      );

    const totalProjectRevenue =
      projectBillings.reduce(
        (sum, item) => sum + item.billingAmount,
        0,
      );

    return {
      nextMonthSalesForecast:
        (totalSales * 1.10).toFixed(2),

      nextMonthPayrollForecast:
        (totalPayroll * 1.05).toFixed(2),

      nextProjectRevenueForecast:
        (totalProjectRevenue * 1.15).toFixed(2),

      forecastLogic:
        'Based on current trend + growth assumption',
    };
  }
}
