import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  ALL_RECORDS,
  RecordScope,
  receivableWhere,
} from '../../revenueos/record-scope/record-scope';
import { CreateAccountsReceivableDto } from './dto/create-accounts-receivable.dto';

@Injectable()
export class AccountsReceivableService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateAccountsReceivableDto) {
    return this.prisma.accountsReceivable.create({
      data: {
        salesInvoiceId: data.salesInvoiceId,
        dueDate: new Date(data.dueDate),
        outstandingAmount: data.outstandingAmount,
        balanceAmount: data.outstandingAmount,
      },
    });
  }

  async findAll(scope: RecordScope = ALL_RECORDS) {
    return this.prisma.accountsReceivable.findMany({
      where: receivableWhere(scope),
      include: {
        salesInvoice: true,
      },
    });
  }
}
