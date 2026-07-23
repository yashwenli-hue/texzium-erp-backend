import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateVendorLedgerDto } from './dto/create-vendor-ledger.dto';

@Injectable()
export class VendorLedgersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateVendorLedgerDto) {
    return this.prisma.vendorLedger.create({
      data: {
        vendorName: data.vendorName,
        vendorBillId: data.vendorBillId,
        debitAmount: data.debitAmount || 0,
        creditAmount: data.creditAmount || 0,
        balanceAmount: data.balanceAmount,
        entryDate: new Date(data.entryDate),
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.vendorLedger.findMany({
      include: {
        vendorBill: true,
      },
    });
  }
}
