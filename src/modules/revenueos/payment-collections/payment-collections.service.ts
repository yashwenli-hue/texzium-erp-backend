import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreatePaymentCollectionDto } from './dto/create-payment-collection.dto';

@Injectable()
export class PaymentCollectionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePaymentCollectionDto) {
    const receivable = await this.prisma.accountsReceivable.findFirst({
      where: {
        salesInvoiceId: data.salesInvoiceId,
      },
    });

    if (!receivable) {
  throw new Error('Receivable not found');
}

const paymentRecord =
  await this.prisma.paymentCollection.create({
    data: {
      accountsReceivableId: receivable.id,
      paymentDate: new Date(data.paymentDate),
      amount: data.amountReceived,
      paymentMode: data.paymentMode,
      referenceNumber: data.referenceNo,
      remarks: 'Customer payment received',
    },
  });

const newPaidAmount =
  receivable.paidAmount + data.amountReceived;

    const newBalance =
      receivable.outstandingAmount - newPaidAmount;

    const paymentStatus =
      newBalance <= 0 ? 'PAID' : 'PARTIAL';

    const updatedReceivable =
      await this.prisma.accountsReceivable.update({
        where: {
          id: receivable.id,
        },
        data: {
          paidAmount: newPaidAmount,
          balanceAmount: newBalance,
          paymentStatus: paymentStatus,
        },
      });

    // Customer Ledger Credit Entry
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: {
        id: data.salesInvoiceId,
      },
    });

    if (!invoice) {
      throw new Error('Invoice not found');
    }

    const lastLedger =
      await this.prisma.customerLedger.findFirst({
        where: {
          customerName: invoice.customerName!,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

    const previousBalance =
      lastLedger?.balanceAmount ?? 0;

    const newLedgerBalance =
      previousBalance - data.amountReceived;

    await this.prisma.customerLedger.create({
      data: {
        customerName: invoice.customerName!,
        salesInvoiceId: invoice.id,
        debitAmount: 0,
        creditAmount: data.amountReceived,
        balanceAmount: newLedgerBalance,
        entryDate: new Date(data.paymentDate),
        remarks: `Payment received ${data.referenceNo}`,
      },
    });

    return {
  paymentRecord,
  updatedReceivable,
};
  }
}
