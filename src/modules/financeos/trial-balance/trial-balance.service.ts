import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class TrialBalanceService {
  constructor(private prisma: PrismaService) {}

  async getTrialBalance() {
    const lines =
      await this.prisma.journalLine.findMany();

    const grouped: Record<
      string,
      { totalDebit: number; totalCredit: number }
    > = {};

    for (const line of lines) {
      if (!grouped[line.accountId]) {
        grouped[line.accountId] = {
          totalDebit: 0,
          totalCredit: 0,
        };
      }

      grouped[line.accountId].totalDebit +=
        line.debitAmount;

      grouped[line.accountId].totalCredit +=
        line.creditAmount;
    }

    const totalDebit =
      Object.values(grouped).reduce(
        (sum, item) => sum + item.totalDebit,
        0,
      );

    const totalCredit =
      Object.values(grouped).reduce(
        (sum, item) => sum + item.totalCredit,
        0,
      );

    return {
      accounts: grouped,
      totalDebit,
      totalCredit,
      isBalanced: totalDebit === totalCredit,
    };
  }
}
