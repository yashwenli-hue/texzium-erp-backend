import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesInvoiceItemDto } from './dto/create-sales-invoice-item.dto';

@Injectable()
export class SalesInvoiceItemsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesInvoiceItemDto) {
    const invoice =
      await this.prisma.salesInvoice.findUnique({
        where: {
          id: data.salesInvoiceId,
        },
      });

    if (!invoice) {
      throw new Error('Sales Invoice not found');
    }

    return this.prisma.salesInvoiceItem.create({
      data: {
        salesInvoiceId: data.salesInvoiceId,
        productId: data.productId,
        quantity: data.quantity,
        rate: data.rate,
        taxableAmount: data.taxableAmount,
        gstAmount: data.gstAmount,
        totalAmount: data.totalAmount,
      },
    });
  }
}
