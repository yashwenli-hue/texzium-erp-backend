import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateRmaDto } from './dto/create-rma.dto';

@Injectable()
export class RmaService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateRmaDto) {
    const warranty = await this.prisma.warranty.findUnique({
      where: { id: data.warrantyId },
    });

    if (!warranty) {
      throw new Error('Warranty not found');
    }

    return this.prisma.rMA.create({
      data: {
        warrantyId: data.warrantyId,
        serviceTicketId: data.serviceTicketId,
        reason: data.reason,
        remarks: data.remarks,
      },
    });
  }

  async approve(
    id: string,
    inspectionNotes: string,
    replacementType: string,
  ) {
    return this.prisma.rMA.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        inspectionNotes,
        replacementType,
      },
    });
  }

  async reject(id: string, inspectionNotes: string) {
    return this.prisma.rMA.update({
      where: { id },
      data: {
        approvalStatus: 'REJECTED',
        inspectionNotes,
      },
    });
  }

  async findAll() {
    return this.prisma.rMA.findMany({
      include: {
        warranty: true,
        serviceTicket: true,
      },
    });
  }
}
