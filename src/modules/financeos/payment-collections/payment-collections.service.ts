import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreatePaymentCollectionDto } from './dto/create-payment-collection.dto';

@Injectable()
export class PaymentCollectionsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePaymentCollectionDto) {
    const receivable = await this.prisma.accountsReceivable.findUnique({
      where: { id: data.accountsReceivableId },
    });

    if (!receivable) {
      throw new Error('Accounts Receivable not found');
    }

    const newPaidAmount = receivable.paidAmount + data.amount;
    const newBalanceAmount = receivable.balanceAmount - data.amount;

    let paymentStatus = 'PARTIAL';

    if (newBalanceAmount <= 0) {
      paymentStatus = 'PAID';
    }

    await this.prisma.accountsReceivable.update({
      where: { id: receivable.id },
      data: {
        paidAmount: newPaidAmount,
        balanceAmount: newBalanceAmount < 0 ? 0 : newBalanceAmount,
        paymentStatus,
      },
    });

    return this.prisma.paymentCollection.create({
      data: {
        accountsReceivableId: data.accountsReceivableId,
        paymentDate: new Date(data.paymentDate),
        amount: data.amount,
        paymentMode: data.paymentMode,
        referenceNumber: data.referenceNumber,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.paymentCollection.findMany({
      include: {
        accountsReceivable: true,
      },
    });
  }
}
