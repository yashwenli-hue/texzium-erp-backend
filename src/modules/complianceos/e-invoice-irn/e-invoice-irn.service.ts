import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class EInvoiceIrnService {
  constructor(private prisma: PrismaService) {}

  async generate(salesInvoiceId: string) {
    // Check if IRN already exists for this invoice
    const existing = await this.prisma.eInvoice.findFirst({
      where: {
        salesInvoiceId,
      },
    });

    if (existing) {
      return existing;
    }

    // Generate unique IRN
    const irn =
      'IRN-' +
      Date.now() +
      '-' +
      Math.floor(Math.random() * 10000);

    // Generate Ack Number
    const ack =
      'ACK-' +
      Math.floor(Math.random() * 1000000);

    // Generate QR Payload
    const qrPayload =
      `IRN:${irn}|ACK:${ack}|INVOICE:${salesInvoiceId}`;

    // Create E-Invoice Record
    return this.prisma.eInvoice.create({
      data: {
        salesInvoiceId,
        irnNumber: irn,
        ackNumber: ack,
        qrPayload,
      },
    });
  }

  async findAll() {
    return this.prisma.eInvoice.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
