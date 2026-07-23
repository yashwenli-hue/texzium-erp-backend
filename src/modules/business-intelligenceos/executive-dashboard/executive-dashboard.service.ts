import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class ExecutiveDashboardService {
  constructor(private prisma: PrismaService) {}

  async getDashboard() {
    const salesInvoices = await this.prisma.salesInvoice.findMany();
    const receivables = await this.prisma.accountsReceivable.findMany();
    const payables = await this.prisma.accountsPayable.findMany();
    const employees = await this.prisma.employee.findMany();
    const projects = await this.prisma.project.findMany();
    const inventory = await this.prisma.inventoryItem.findMany();

    const totalSales = salesInvoices.reduce(
      (sum, item) => sum + item.totalAmount,
      0,
    );

    const totalReceivables = receivables.reduce(
      (sum, item) => sum + item.balanceAmount,
      0,
    );

    const totalPayables = payables.reduce(
      (sum, item) => sum + item.balanceAmount,
      0,
    );

    const inventoryValue = inventory.reduce(
      (sum, item) => sum + item.stockQty * 1000,
      0,
    );

    return {
      totalSales,
      totalReceivables,
      totalPayables,
      totalEmployees: employees.length,
      activeProjects: projects.length,
      inventoryValue,
    };
  }
}
