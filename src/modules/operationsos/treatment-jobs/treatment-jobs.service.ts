import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateTreatmentJobDto } from './dto/create-treatment-job.dto';

@Injectable()
export class TreatmentJobsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateTreatmentJobDto) {
    return this.prisma.treatmentJob.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.treatmentJob.findMany({
      include: {
        stockInspection: true,
      },
    });
  }
}
