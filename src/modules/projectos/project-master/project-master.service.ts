import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Injectable()
export class ProjectMasterService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateProjectDto) {
    return this.prisma.project.create({
      data: {
        projectCode: data.projectCode,
        projectName: data.projectName,
        customerName: data.customerName,
        startDate: new Date(data.startDate),
        endDate: data.endDate
          ? new Date(data.endDate)
          : null,
        budgetAmount: data.budgetAmount,
      },
    });
  }

  async findAll() {
    return this.prisma.project.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
