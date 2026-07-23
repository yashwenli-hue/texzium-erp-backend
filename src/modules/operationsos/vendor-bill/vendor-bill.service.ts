import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';

@Injectable()
export class VendorBillService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateVendorBillDto) {
    return this.prisma.vendorBill.create({
      data: {
        goodsReceiptId: data.goodsReceiptId,
        vendorName: data.vendorName,
        billNumber: data.billNumber,
        billDate: new Date(data.billDate),
        taxableAmount: data.taxableAmount,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.vendorBill.findMany({
      include: {
        goodsReceipt: true,
        payables: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
