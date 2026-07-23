import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';

@Injectable()
export class DeliveryService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateDeliveryDto) {
    const dispatch = await this.prisma.dispatch.findUnique({
      where: { id: data.dispatchId },
    });

    if (!dispatch) {
      throw new Error('Dispatch record not found');
    }

    return this.prisma.delivery.create({
      data: {
        dispatchId: data.dispatchId,
        deliveryDate: new Date(data.deliveryDate),
        receivedBy: data.receivedBy,
        proofOfDelivery: data.proofOfDelivery,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.delivery.findMany({
      include: {
        dispatch: true,
      },
    });
  }
}
