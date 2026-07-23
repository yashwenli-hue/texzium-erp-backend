import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateCompanyGstDto } from './dto/create-company-gst.dto';

@Injectable()
export class CompanyGstService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateCompanyGstDto) {
    return this.prisma.companyGSTRegistration.create({
      data: {
        companyId: data.companyId,
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
        registrationType: data.registrationType,
        isDefault: data.isDefault ?? false,
      },
    });
  }

  async findAll() {
    return this.prisma.companyGSTRegistration.findMany({
      include: {
        company: true,
      },
    });
  }
}

