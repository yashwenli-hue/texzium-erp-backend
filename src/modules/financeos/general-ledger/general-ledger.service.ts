import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class GeneralLedgerService {
  constructor(private prisma: PrismaService) {}

  async getLedger(accountId: string) {
    const lines =
      await this.prisma.journalLine.findMany({
        where: {
          accountId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

    const totalDebit =
      lines.reduce(
        (sum, line) => sum + line.debitAmount,
        0,
      );

    const totalCredit =
      lines.reduce(
        (sum, line) => sum + line.creditAmount,
        0,
      );

    const closingBalance =
      totalDebit - totalCredit;

    return {
      accountId,
      totalTransactions: lines.length,
      totalDebit,
      totalCredit,
      closingBalance,
      ledgerLines: lines,
    };
  }
}
