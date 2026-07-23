import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateWarrantyDto } from './dto/create-warranty.dto';

@Injectable()
export class WarrantyService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateWarrantyDto) {
    return this.prisma.warranty.create({
      data: {
        salesInvoiceId: data.salesInvoiceId,
        serialNumber: data.serialNumber,
        warrantyStart: new Date(data.warrantyStart),
        warrantyEnd: new Date(data.warrantyEnd),
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.warranty.findMany({
      include: {
        salesInvoice: true,
      },
    });
  }
}
