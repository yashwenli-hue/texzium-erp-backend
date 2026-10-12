import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesInvoiceItemDto } from './dto/create-sales-invoice-item.dto';

@Injectable()
export class SalesInvoiceItemsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesInvoiceItemDto) {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: {
        id: data.salesInvoiceId,
      },
    });

    if (!invoice) {
      throw new Error('Sales Invoice not found');
    }

    // An invoice issued with the priced lines it was sold with is complete:
    // an item added by hand would no longer add up to its amounts.
    if (
      (await this.prisma.salesInvoiceItem.count({
        where: {
          salesInvoiceId: data.salesInvoiceId,
          sourceLineId: { not: null },
        },
      })) > 0
    ) {
      throw new ConflictException(
        'This invoice was issued with its priced lines; items cannot be added to it.',
      );
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
