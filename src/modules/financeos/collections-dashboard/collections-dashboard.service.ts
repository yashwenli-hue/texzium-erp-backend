import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class CollectionsDashboardService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const receivables =
      await this.prisma.accountsReceivable.findMany();

    const totalOutstanding =
      receivables.reduce(
        (sum, item) => sum + item.balanceAmount,
        0,
      );

    const totalCollected =
      receivables.reduce(
        (sum, item) => sum + item.paidAmount,
        0,
      );

    return {
      totalInvoices: receivables.length,
      totalOutstanding,
      totalCollected,
    };
  }

  async aging() {
    const receivables =
      await this.prisma.accountsReceivable.findMany();

    const today = new Date();

    const buckets = {
      days0to30: 0,
      days31to60: 0,
      days61to90: 0,
      above90: 0,
    };

    for (const item of receivables) {
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
    return this.prisma.accountsReceivable.findMany({
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

  async recoveryRate() {
  const receivables =
    await this.prisma.accountsReceivable.findMany();

  const totalOutstanding =
    receivables.reduce(
      (sum, item) => sum + item.balanceAmount,
      0,
    );

  const totalCollected =
    receivables.reduce(
      (sum, item) => sum + item.paidAmount,
      0,
    );

  const totalInvoiceValue =
    totalOutstanding + totalCollected;

  const recoveryRate =
    totalInvoiceValue > 0
      ? (totalCollected / totalInvoiceValue) * 100
      : 0;

  return {
    totalInvoiceValue,
    totalCollected,
    recoveryRate: recoveryRate.toFixed(2) + '%',
  };
}

async customerRanking() {
  return this.prisma.customerLedger.groupBy({
    by: ['customerName'],
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

async efficiency() {
  const receivables =
    await this.prisma.accountsReceivable.findMany();

  const total = receivables.length;

  const paid =
    receivables.filter(
      (x) => x.paymentStatus === 'PAID',
    ).length;

  const partial =
    receivables.filter(
      (x) => x.paymentStatus === 'PARTIAL',
    ).length;

  const pending =
    receivables.filter(
      (x) => x.paymentStatus === 'PENDING',
    ).length;

  const writtenOff =
    receivables.filter(
      (x) => x.paymentStatus === 'WRITTEN_OFF',
    ).length;

  return {
    total,
    paid,
    partial,
    pending,
    writtenOff,
  };
}


}
