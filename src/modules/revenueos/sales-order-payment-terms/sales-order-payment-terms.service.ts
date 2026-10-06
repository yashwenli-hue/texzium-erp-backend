import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderPaymentTermDto } from './dto/create-sales-order-payment-term.dto';
import { SALES_ORDER_NOT_FOUND_MESSAGE } from '../sales-orders/sales-order-lifecycle';

@Injectable()
export class SalesOrderPaymentTermsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesOrderPaymentTermDto) {
    const salesOrder = await this.prisma.salesOrder.findUnique({
      where: { id: data.salesOrderId },
      select: { id: true },
    });

    if (!salesOrder) {
      throw new NotFoundException(SALES_ORDER_NOT_FOUND_MESSAGE);
    }

    return this.prisma.salesOrderPaymentTerm.create({
      data: {
        salesOrderId: data.salesOrderId,
        paymentType: data.paymentType,
        advanceAmount: data.advanceAmount,
        balanceAmount: data.balanceAmount,
        creditDays: data.creditDays,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.salesOrderPaymentTerm.findMany({
      include: {
        salesOrder: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
