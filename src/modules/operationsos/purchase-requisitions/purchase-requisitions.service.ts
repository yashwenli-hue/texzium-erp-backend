import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';

@Injectable()
export class PurchaseRequisitionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePurchaseRequisitionDto) {
    return this.prisma.purchaseRequisition.create({
      data,
    });
  }

  async findAll() {
    return this.prisma.purchaseRequisition.findMany({
      include: {
        salesOrder: true,
        inventoryItem: true,
      },
    });
  }

  async approve(id: string) {
  return this.prisma.purchaseRequisition.update({
    where: { id },
    data: {
      status: 'APPROVED',
    },
  });
}

async reject(id: string, remarks: string) {
  return this.prisma.purchaseRequisition.update({
    where: { id },
    data: {
      status: 'REJECTED',
      remarks,
    },
  });
}

async convertToPurchaseOrder(id: string) {
  const pr =
    await this.prisma.purchaseRequisition.findUnique({
      where: { id },
    });

  if (!pr) {
    throw new Error(
      'Purchase Requisition not found',
    );
  }

  if (pr.status !== 'APPROVED') {
    throw new Error(
      'Only approved requisitions can be converted',
    );
  }

  return this.prisma.purchaseOrder.create({
    data: {
      purchaseRequisitionId: pr.id,
      orderQty: pr.requestedQty,
      status: 'OPEN',
    },
  });
}





}
