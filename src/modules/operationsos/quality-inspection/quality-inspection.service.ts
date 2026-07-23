import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateQualityInspectionDto } from './dto/create-quality-inspection.dto';

@Injectable()
export class QualityInspectionService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateQualityInspectionDto) {
    return this.prisma.qualityInspection.create({
      data: {
        goodsReceiptId: data.goodsReceiptId,
        status: data.status,
        acceptedQty: data.acceptedQty,
        rejectedQty: data.rejectedQty,
        remarks: data.remarks,
        inspectorName: data.inspectorName,
      },
    });
  }

  async findAll() {
    return this.prisma.qualityInspection.findMany({
      include: {
        goodsReceipt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
