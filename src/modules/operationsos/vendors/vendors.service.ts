import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateVendorDto } from './dto/create-vendor.dto';

@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateVendorDto) {
    const vendor = await this.prisma.vendor.create({
      data: {
        vendorCode: data.vendorCode,
        vendorName: data.vendorName,
        panNumber: data.panNumber,
        email: data.email,
        phone: data.phone,
        isCustomer: data.isCustomer ?? false,
      },
    });

    // Auto create Customer if marked
    if (data.isCustomer) {
      const customer = await this.prisma.customer.create({
        data: {
          customerCode: `CUST-${Date.now()}`,
          customerName: data.vendorName,
          panNumber: data.panNumber,
          email: data.email,
          phone: data.phone,
          customerType: 'B2B',
          linkedVendorId: vendor.id,
        },
      });

      await this.prisma.vendor.update({
        where: { id: vendor.id },
        data: {
          linkedCustomerId: customer.id,
        },
      });
    }

    return vendor;
  }

  async findAll() {
    return this.prisma.vendor.findMany();
  }
}
