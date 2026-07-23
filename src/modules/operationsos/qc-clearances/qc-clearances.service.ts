import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateQcClearanceDto } from './dto/create-qc-clearance.dto';

@Injectable()
export class QcClearancesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateQcClearanceDto) {
    return this.prisma.qCClearance.create({
      data: {
        treatmentJobId: data.treatmentJobId,
        qcDate: new Date(data.qcDate),
        qcStatus: data.qcStatus,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.qCClearance.findMany({
      include: {
        treatmentJob: true,
      },
    });
  }
}
