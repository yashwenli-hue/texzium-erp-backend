import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAmcDto } from './dto/create-amc.dto';

@Injectable()
export class AmcService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateAmcDto) {
    const warranty = await this.prisma.warranty.findUnique({
      where: { id: data.warrantyId },
    });

    if (!warranty) {
      throw new Error('Warranty not found');
    }

    return this.prisma.aMC.create({
      data: {
        warrantyId: data.warrantyId,
        amcStart: new Date(data.amcStart),
        amcEnd: new Date(data.amcEnd),
        visitFrequency: data.visitFrequency,
        contractValue: data.contractValue,
        remarks: data.remarks,
        status: 'OFFERED',
        customerStatus: 'PENDING',
      },
    });
  }

  async acceptAmc(id: string) {
    return this.prisma.aMC.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        customerStatus: 'ACCEPTED',
      },
    });
  }

  async rejectAmc(id: string) {
    return this.prisma.aMC.update({
      where: { id },
      data: {
        status: 'REJECTED',
        customerStatus: 'REJECTED',
      },
    });
  }

  async findAll() {
    return this.prisma.aMC.findMany({
      include: {
        warranty: true,
      },
    });
  }
}
