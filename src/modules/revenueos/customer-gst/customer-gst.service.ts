import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateCustomerGstDto } from './dto/create-customer-gst.dto';

@Injectable()
export class CustomerGstService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCustomerGstDto) {
    return this.prisma.customerGSTRegistration.create({
      data: {
        customerId: data.customerId,
        gstin: data.gstin,
        legalName: data.legalName,
        tradeName: data.tradeName,
        branchName: data.branchName,
        stateCode: data.stateCode,
        stateName: data.stateName,
        addressLine1: data.addressLine1,
        addressLine2: data.addressLine2,
        city: data.city,
        pincode: data.pincode,
        isDefault: data.isDefault ?? false,
      },
    });
  }

  async findAll() {
    return this.prisma.customerGSTRegistration.findMany({
      include: {
        customer: true,
      },
    });
  }
}
