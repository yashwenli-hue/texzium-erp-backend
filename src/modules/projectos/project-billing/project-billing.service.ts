import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateProjectBillingDto } from './dto/create-project-billing.dto';

@Injectable()
export class ProjectBillingService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateProjectBillingDto) {
    return this.prisma.projectBilling.create({
      data: {
        projectId: data.projectId,
        billingDate: new Date(data.billingDate),
        billingAmount: data.billingAmount,
        billingType: data.billingType,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.projectBilling.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
