import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { WarrantyPolicyType } from '@prisma/client';

import { DocumentNumberGeneratorService } from '../../adminos/document-number-series/services/document-number-generator.service';

@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentNumberGenerator: DocumentNumberGeneratorService,
  ) {}

  async create(data: CreateSalesInvoiceDto) {
  const invoiceNumber =
  await this.documentNumberGenerator.generate(
    'FinanceOS',
    'Sales Invoice',
  );  

  // GST Calculation
    const gstAmount =
      (data.taxableAmount * data.gstPercentage) / 100;

    const totalAmount = data.taxableAmount + gstAmount;

    // Create Sales Invoice
    const salesInvoice = await this.prisma.salesInvoice.create({
      data: {
        salesOrderId: data.salesOrderId,
        invoiceDate: new Date(data.invoiceDate),
        taxableAmount: data.taxableAmount,
        gstAmount,
        totalAmount,
        invoiceNumber,    
  },
    });

    // Fetch Sales Order with linked Inventory Item
    const salesOrder = await this.prisma.salesOrder.findUnique({
      where: {
        id: data.salesOrderId,
      },
      include: {
        inventoryItem: true,
      },
    });

    // If no sales order or no product linked, stop here
    if (!salesOrder || !salesOrder.inventoryItem) {
      return salesInvoice;
    }

    const product = salesOrder.inventoryItem;

    // Warranty Automation Logic
    if (
      product.warrantyApplicable &&
      product.warrantyPolicyType === WarrantyPolicyType.INVOICE_BASED
    ) {
      const warrantyStart = new Date(data.invoiceDate);
      const warrantyEnd = new Date(warrantyStart);

      warrantyEnd.setMonth(
        warrantyEnd.getMonth() + (product.warrantyMonths ?? 0),
      );

      await this.prisma.warranty.create({
        data: {
          salesInvoiceId: salesInvoice.id,
          serialNumber: `AUTO-${product.sku}-${Date.now()}`,
          warrantyStart,
          warrantyEnd,
          status: 'ACTIVE',
          remarks: 'Auto-created from Invoice Based Warranty Policy',
        },
      });
    }

    return salesInvoice;
  }

  async findAll() {
    return this.prisma.salesInvoice.findMany({
      include: {
        salesOrder: {
          include: {
            inventoryItem: true,
          },
        },
      },
    });
  }
}
