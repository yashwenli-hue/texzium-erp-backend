import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class AiBusinessAdvisorService {
  constructor(private prisma: PrismaService) {}

  async advise() {
    const receivables =
      await this.prisma.accountsReceivable.findMany();

    const vendorBills =
      await this.prisma.vendorBill.findMany();

    const projectCosts =
      await this.prisma.projectCost.findMany();

    const projectBillings =
      await this.prisma.projectBilling.findMany();

    const attendance =
      await this.prisma.attendance.findMany();

    const totalReceivables =
      receivables.reduce(
        (sum, item) => sum + item.balanceAmount,
        0,
      );

    const totalVendorSpend =
      vendorBills.reduce(
        (sum, item) => sum + item.totalAmount,
        0,
      );

    const totalProjectCost =
      projectCosts.reduce(
        (sum, item) => sum + item.amount,
        0,
      );

    const totalProjectRevenue =
      projectBillings.reduce(
        (sum, item) => sum + item.billingAmount,
        0,
      );

    const presentCount =
      attendance.filter(
        (a) => a.status === 'PRESENT',
      ).length;

    const attendanceRate =
      attendance.length > 0
        ? (presentCount / attendance.length) * 100
        : 0;

    const advice: string[] = [];

    if (totalReceivables > 100000) {
      advice.push(
        'High outstanding receivables. Improve collections.',
      );
    }

    if (totalVendorSpend > 250000) {
      advice.push(
        'Vendor spend is high. Negotiate better rates.',
      );
    }

    if (
      totalProjectRevenue > 0 &&
      (totalProjectRevenue - totalProjectCost) /
        totalProjectRevenue <
        0.25
    ) {
      advice.push(
        'Project margins are low. Review costing strategy.',
      );
    }

    if (attendanceRate < 80) {
      advice.push(
        'Attendance is below healthy threshold. Review workforce discipline.',
      );
    }

    if (advice.length === 0) {
      advice.push(
        'Business performance looks healthy. Maintain momentum.',
      );
    }

    return {
      totalReceivables,
      totalVendorSpend,
      projectMargin:
        totalProjectRevenue > 0
          ? (
              ((totalProjectRevenue - totalProjectCost) /
                totalProjectRevenue) *
              100
            ).toFixed(2) + '%'
          : '0%',
      attendanceRate:
        attendanceRate.toFixed(2) + '%',
      recommendations: advice,
    };
  }
}
