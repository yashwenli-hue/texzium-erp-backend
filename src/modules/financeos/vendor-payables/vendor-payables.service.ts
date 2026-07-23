import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateVendorPayableDto } from './dto/create-vendor-payable.dto';

@Injectable()
export class VendorPayablesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateVendorPayableDto) {
    const bill =
      await this.prisma.vendorBill.findUnique({
        where: {
          id: data.vendorBillId,
        },
      });

    if (!bill) {
      throw new Error('Vendor Bill not found');
    }

    return this.prisma.accountsPayable.create({
      data: {
        vendorBillId: data.vendorBillId,
        vendorName: data.vendorName,
        dueDate: new Date(data.dueDate),
        outstandingAmount: data.outstandingAmount,
        balanceAmount: data.outstandingAmount,
      },
    });
  }
}
