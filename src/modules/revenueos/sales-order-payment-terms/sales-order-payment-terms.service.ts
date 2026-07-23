import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderPaymentTermDto } from './dto/create-sales-order-payment-term.dto';

@Injectable()
export class SalesOrderPaymentTermsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesOrderPaymentTermDto) {
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
