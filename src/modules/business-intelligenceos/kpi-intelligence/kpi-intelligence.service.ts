import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class KpiIntelligenceService {
  constructor(private prisma: PrismaService) {}

  async getKPIs() {
    const leads = await this.prisma.lead.findMany();
    const salesOrders = await this.prisma.salesOrder.findMany();
    const receivables = await this.prisma.accountsReceivable.findMany();
    const projectBillings = await this.prisma.projectBilling.findMany();
    const projectCosts = await this.prisma.projectCost.findMany();
    const attendance = await this.prisma.attendance.findMany();
    const inventory = await this.prisma.inventoryItem.findMany();
    const vendorBills = await this.prisma.vendorBill.findMany();

    const salesConversionRate =
      leads.length > 0
        ? ((salesOrders.length / leads.length) * 100).toFixed(2) + '%'
        : '0%';

    const totalReceivable =
      receivables.reduce((sum, r) => sum + r.balanceAmount, 0);

    const totalRevenue =
      projectBillings.reduce((sum, b) => sum + b.billingAmount, 0);

    const totalCost =
      projectCosts.reduce((sum, c) => sum + c.amount, 0);

    const projectMargin =
      totalRevenue > 0
        ? (((totalRevenue - totalCost) / totalRevenue) * 100).toFixed(2) + '%'
        : '0%';

    const presentCount =
      attendance.filter(a => a.status === 'PRESENT').length;

    const attendanceRate =
      attendance.length > 0
        ? ((presentCount / attendance.length) * 100).toFixed(2) + '%'
        : '0%';

    const inventoryUtilization =
      inventory.reduce(
        (sum, item) =>
          sum +
          ((item.stockQty - item.availableQty) / item.stockQty) * 100,
        0,
      ) / (inventory.length || 1);

    const totalVendorSpend =
      vendorBills.reduce((sum, v) => sum + v.totalAmount, 0);

    return {
      salesConversionRate,
      outstandingReceivables: totalReceivable,
      projectMargin,
      attendanceRate,
      inventoryUtilization: inventoryUtilization.toFixed(2) + '%',
      totalVendorSpend,
    };
  }
}
