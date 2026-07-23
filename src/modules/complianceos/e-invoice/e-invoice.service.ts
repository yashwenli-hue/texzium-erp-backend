import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class EInvoiceService {
  constructor(private prisma: PrismaService) {}

  async generateIRN(salesInvoiceId: string) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: salesInvoiceId },
      include: {
        salesOrder: true,
      },
    });

    if (!invoice) {
      throw new Error('Sales Invoice not found');
    }

    const fakeIRN =
      'IRN-' + Math.random().toString(36).substring(2, 15);

    const ackNumber =
      'ACK-' + Math.floor(Math.random() * 1000000);

    const gstRegistry =
      await this.prisma.gSTInvoiceRegistry.create({
        data: {
          salesInvoiceId: invoice.id,
          irn: fakeIRN,
          ackNumber: ackNumber,
          ackDate: new Date(),
          qrCode: `QR-${fakeIRN}`,
          signedInvoice: `SIGNED-${fakeIRN}`,
        },
      });

    await this.prisma.salesInvoice.update({
      where: { id: invoice.id },
      data: {
        irnNumber: fakeIRN,
      },
    });

    return {
      message: 'IRN Generated Successfully',
      gstRegistry,
    };
  }
}
