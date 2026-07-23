import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateQualityInspectionDto } from './dto/create-quality-inspection.dto';

@Injectable()
export class QualityInspectionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateQualityInspectionDto) {
    const grn = await this.prisma.goodsReceipt.findUnique({
      where: { id: data.goodsReceiptId },
      include: {
        purchaseOrder: {
          include: {
            purchaseRequisition: true,
          },
        },
      },
    });

    if (!grn) {
      throw new Error('Goods Receipt not found');
    }

    const inspection =
      await this.prisma.qualityInspection.create({
        data: {
          goodsReceiptId: data.goodsReceiptId,
          acceptedQty: data.acceptedQty,
          rejectedQty: data.rejectedQty,
          remarks: data.remarks,
          inspectorName: data.inspectorName,
          status:
            data.rejectedQty > 0
              ? 'PARTIAL_PASS'
              : 'PASSED',
        },
      });

    if (data.rejectedQty > 0) {
  await this.prisma.serviceTicket.create({
    data: {
      warrantyId:
        'd6783719-e4ae-4af3-b3cc-0491698790f7',        
      complaintTitle: 'QC Rework Required',
      complaintDetail: `${data.rejectedQty} units failed quality inspection and need rework.`,
      priority: 'HIGH',
      status: 'OPEN',
      ticketType: 'QC_REWORK',
      sourceType: 'QUALITY_INSPECTION',
      sourceId: inspection.id,
    },
  });
}

    return inspection;
  }

  async findAll() {
    return this.prisma.qualityInspection.findMany({
      include: {
        goodsReceipt: true,
      },
    });
  }
}
