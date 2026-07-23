import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class CustomerStatementsService {
  constructor(private prisma: PrismaService) {}

  async getStatement(customerName: string) {
    const ledger =
      await this.prisma.customerLedger.findMany({
        where: {
          customerName: customerName,
        },
        orderBy: {
          entryDate: 'asc',
        },
      });

    const openingBalance =
      ledger.length > 0 ? ledger[0].balanceAmount : 0;

    const closingBalance =
      ledger.length > 0
        ? ledger[ledger.length - 1].balanceAmount
        : 0;

    return {
      customerName,
      openingBalance,
      closingBalance,
      entries: ledger,
    };
  }
}
