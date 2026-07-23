import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class GstReturnsService {
  constructor(private prisma: PrismaService) {}

  async generateGstr1() {
    const invoices = await this.prisma.salesInvoice.findMany({
      include: {
        salesOrder: true,
      },
    });

    const b2b = invoices.filter(
      (x) => x.salesOrder?.buyerGstId,
    );

    const b2c = invoices.filter(
      (x) => !x.salesOrder?.buyerGstId,
    );

    return {
      totalInvoices: invoices.length,
      b2bCount: b2b.length,
      b2cCount: b2c.length,
      invoices,
    };
  }

  async generateGstr3b() {
    const invoices = await this.prisma.salesInvoice.findMany();

    const taxableValue = invoices.reduce(
      (sum, x) => sum + x.taxableAmount,
      0,
    );

    const gstValue = invoices.reduce(
      (sum, x) => sum + x.gstAmount,
      0,
    );

    return {
      taxableValue,
      gstValue,
    };
  }

  async generateHsnSummary() {
    const inventory = await this.prisma.inventoryItem.findMany({
      include: {
        hsnMaster: true,
      },
    });

    return inventory.map((x) => ({
      sku: x.sku,
      productName: x.productName,
      hsnCode: x.hsnMaster?.hsnCode,
      gstRate: x.hsnMaster?.gstRate,
    }));
  }
}
