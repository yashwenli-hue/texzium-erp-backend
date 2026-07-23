import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateChartOfAccountDto) {
    return this.prisma.chartOfAccount.create({
      data: {
        accountCode: data.accountCode,
        accountName: data.accountName,
        accountType: data.accountType,
        accountGroupId: data.accountGroupId,
        openingBalance: data.openingBalance || 0,
        currentBalance: data.openingBalance || 0,
      },
    });
  }

  async findAll() {
    return this.prisma.chartOfAccount.findMany({
      include: {
        accountGroup: true,
      },
    });
  }
}
