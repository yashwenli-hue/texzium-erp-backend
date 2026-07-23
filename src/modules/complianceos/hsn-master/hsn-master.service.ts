import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateHsnDto } from './dto/create-hsn.dto';

@Injectable()
export class HsnMasterService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateHsnDto) {
    return this.prisma.hSNMaster.create({
      data: {
        hsnCode: data.hsnCode,
        description: data.description,
        gstRate: data.gstRate,
        cgstRate: data.cgstRate,
        sgstRate: data.sgstRate,
        igstRate: data.igstRate,
        cessRate: data.cessRate ?? 0,
        effectiveFrom: new Date(data.effectiveFrom),
        effectiveTo: data.effectiveTo
          ? new Date(data.effectiveTo)
          : null,
        isActive: data.isActive ?? true,
      },
    });
  }

  async findAll() {
    return this.prisma.hSNMaster.findMany({
      orderBy: {
        hsnCode: 'asc',
      },
    });
  }
}
