import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateCustomerLedgerDto } from './dto/create-customer-ledger.dto';

@Injectable()
export class CustomerLedgersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCustomerLedgerDto) {
    return this.prisma.customerLedger.create({
      data: {
        customerName: data.customerName,
        salesInvoiceId: data.salesInvoiceId,
        debitAmount: data.debitAmount || 0,
        creditAmount: data.creditAmount || 0,
        balanceAmount: data.balanceAmount,
        entryDate: new Date(data.entryDate),
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.customerLedger.findMany({
      include: {
        salesInvoice: true,
      },
    });
  }
}
