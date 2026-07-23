import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAmcVisitDto } from './dto/create-amc-visit.dto';

@Injectable()
export class AmcVisitsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateAmcVisitDto) {
    const amc = await this.prisma.aMC.findUnique({
      where: { id: data.amcId },
    });

    if (!amc) {
      throw new Error('AMC not found');
    }

    if (amc.status !== 'ACTIVE') {
      throw new Error('AMC is not active');
    }

    return this.prisma.aMCVisit.create({
      data: {
        amcId: data.amcId,
        scheduledDate: new Date(data.scheduledDate),
        engineerName: data.engineerName,
        remarks: data.remarks,
      },
    });
  }

  async completeVisit(id: string, remarks: string) {
    return this.prisma.aMCVisit.update({
      where: { id },
      data: {
        visitStatus: 'COMPLETED',
        remarks,
        completedAt: new Date(),
      },
    });
  }

  async findAll() {
    return this.prisma.aMCVisit.findMany({
      include: {
        amc: true,
      },
    });
  }
}
