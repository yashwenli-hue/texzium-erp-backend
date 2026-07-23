import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateFinancialYearDto } from './dto/create-financial-year.dto';

@Injectable()
export class FinancialYearsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateFinancialYearDto) {
    return this.prisma.financialYear.create({
      data: {
        yearName: data.yearName,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
      },
    });
  }

  async findAll() {
    return this.prisma.financialYear.findMany();
  }

  async closeYear(id: string) {
    return this.prisma.financialYear.update({
      where: { id },
      data: {
        isClosed: true,
      },
    });
  }
}
