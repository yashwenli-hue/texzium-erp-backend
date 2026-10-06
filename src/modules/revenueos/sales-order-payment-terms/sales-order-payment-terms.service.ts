import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderPaymentTermDto } from './dto/create-sales-order-payment-term.dto';
import {
  canRecordSalesOrderDocuments,
  conflictNotAcceptingDocuments,
  readSalesOrderStatusShared,
} from '../sales-orders/sales-order-lifecycle';

@Injectable()
export class SalesOrderPaymentTermsService {
  constructor(private prisma: PrismaService) {}

  // Payment terms can only be recorded while the order is waiting for store
  // or accounts approval. The status is read under a shared row lock, so a
  // cancellation cannot commit between the check and the insert.
  async create(data: CreateSalesOrderPaymentTermDto) {
    return this.prisma.$transaction(async (tx) => {
      const status = await readSalesOrderStatusShared(tx, data.salesOrderId);

      if (!canRecordSalesOrderDocuments(status)) {
        throw conflictNotAcceptingDocuments('payment terms', status);
      }

      return tx.salesOrderPaymentTerm.create({
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
