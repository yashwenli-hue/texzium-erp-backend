import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class EWayBillService {
  constructor(private prisma: PrismaService) {}

  async generate(
    salesInvoiceId: string,
    body: {
      transporterName: string;
      vehicleNumber: string;
      distanceKm: number;
    },
  ) {
    const existing =
      await this.prisma.eWayBill.findFirst({
        where: { salesInvoiceId },
      });

    if (existing) {
      return existing;
    }

    const ewayBillNumber =
      'EWB-' +
      Date.now() +
      '-' +
      Math.floor(Math.random() * 10000);

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 3);

    return this.prisma.eWayBill.create({
      data: {
        salesInvoiceId,
        ewayBillNumber,
        transporterName: body.transporterName,
        vehicleNumber: body.vehicleNumber,
        distanceKm: body.distanceKm,
        validUntil,
      },
    });
  }

  async findAll() {
    return this.prisma.eWayBill.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
