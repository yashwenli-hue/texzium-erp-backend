import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class ReceiptVouchersService {
  constructor(private prisma: PrismaService) {}

  async generate(paymentCollectionId: string) {
    const payment =
      await this.prisma.paymentCollection.findUnique({
        where: {
          id: paymentCollectionId,
        },
      });

    if (!payment) {
      throw new Error('Payment Collection not found');
    }

    const receiptNumber =
      'RCPT-' + Math.floor(Math.random() * 1000000);

    return this.prisma.receiptVoucher.create({
      data: {
        receiptNumber,
        paymentCollectionId: payment.id,
        receiptDate: payment.paymentDate,
        amountReceived: payment.amount,
        paymentMode: payment.paymentMode,
        referenceNo: payment.referenceNumber,
        remarks: 'Auto generated receipt',
      },
    });
  }
}
