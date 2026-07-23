import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class PayablesDashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const payables =
      await this.prisma.accountsPayable.findMany();

    const totalOutstanding =
      payables.reduce(
        (sum, item) => sum + item.balanceAmount,
        0,
      );

    const totalPaid =
      payables.reduce(
        (sum, item) => sum + item.paidAmount,
        0,
      );

    return {
      totalBills: payables.length,
      totalOutstanding,
      totalPaid,
    };
  }

  async aging() {
    const payables =
      await this.prisma.accountsPayable.findMany();

    const today = new Date();

    const buckets = {
      days0to30: 0,
      days31to60: 0,
      days61to90: 0,
      above90: 0,
    };

    for (const item of payables) {
      const diff =
        Math.floor(
          (today.getTime() - item.dueDate.getTime()) /
          (1000 * 60 * 60 * 24),
        );

      if (diff <= 30) buckets.days0to30 += item.balanceAmount;
      else if (diff <= 60) buckets.days31to60 += item.balanceAmount;
      else if (diff <= 90) buckets.days61to90 += item.balanceAmount;
      else buckets.above90 += item.balanceAmount;
    }

    return buckets;
  }

  async highRisk() {
    return this.prisma.accountsPayable.findMany({
      where: {
        balanceAmount: {
          gt: 100000,
        },
      },
      orderBy: {
        balanceAmount: 'desc',
      },
    });
  }

  async upcomingDue() {
    const today = new Date();
    const next7Days = new Date();
    next7Days.setDate(today.getDate() + 7);

    return this.prisma.accountsPayable.findMany({
      where: {
        dueDate: {
          gte: today,
          lte: next7Days,
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });
  }
}
