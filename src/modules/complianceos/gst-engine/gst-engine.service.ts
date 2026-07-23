import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class GstEngineService {
  constructor(private prisma: PrismaService) {}

  async generateIRN(salesInvoiceId: string) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id: salesInvoiceId },
    });

    if (!invoice) {
      throw new Error('Sales Invoice not found');
    }

    return this.prisma.gSTInvoiceRegistry.create({
      data: {
        salesInvoiceId,
        irn: `IRN-${Date.now()}`,
        ackNumber: `ACK-${Date.now()}`,
        ackDate: new Date(),
        qrCode: `QR-${Date.now()}`,
        signedInvoice: `SIGNED-INVOICE-${Date.now()}`,
        status: 'IRN_GENERATED',
      },
    });
  }

  async generateEWayBill(gstRegistryId: string) {
    return this.prisma.gSTInvoiceRegistry.update({
      where: { id: gstRegistryId },
      data: {
        ewayBillNumber: `EWB-${Date.now()}`,
        status: 'EWAY_GENERATED',
      },
    });
  }

  async findAll() {
    return this.prisma.gSTInvoiceRegistry.findMany({
      include: {
        salesInvoice: true,
      },
    });
  }
}
