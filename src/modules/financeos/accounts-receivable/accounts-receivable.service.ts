import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
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

  async findAll() {
    return this.prisma.accountsReceivable.findMany({
      include: {
        salesInvoice: true,
      },
    });
  }
}
