import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateJournalDto } from './dto/create-journal.dto';

@Injectable()
export class JournalService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateJournalDto) {
    const totalDebit = data.lines.reduce(
      (sum, line) => sum + line.debitAmount,
      0,
    );

    const totalCredit = data.lines.reduce(
      (sum, line) => sum + line.creditAmount,
      0,
    );

    if (totalDebit !== totalCredit) {
      throw new Error('Debit and Credit must be equal');
    }

    const journal = await this.prisma.journalEntry.create({
      data: {
        voucherDate: new Date(data.voucherDate),
        narration: data.narration,
        financialYearId: data.financialYearId,
      },
    });

    for (const line of data.lines) {
      await this.prisma.journalLine.create({
        data: {
          journalEntryId: journal.id,
          accountId: line.accountId,
          debitAmount: line.debitAmount,
          creditAmount: line.creditAmount,
          remarks: line.remarks,
        },
      });

      const account = await this.prisma.chartOfAccount.findUnique({
        where: { id: line.accountId },
      });

      if (account) {
        const newBalance =
          account.currentBalance + line.debitAmount - line.creditAmount;

        await this.prisma.chartOfAccount.update({
          where: { id: line.accountId },
          data: {
            currentBalance: newBalance,
          },
        });
      }
    }

    return journal;
  }

  async findAll() {
    return this.prisma.journalEntry.findMany({
      include: {
        journalLines: {
          include: {
            account: true,
          },
        },
        financialYear: true,
      },
    });
  }
}
