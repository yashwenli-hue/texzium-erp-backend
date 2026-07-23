import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateVendorPaymentDto } from './dto/create-vendor-payment.dto';

@Injectable()
export class VendorPaymentsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateVendorPaymentDto) {
    const payable =
      await this.prisma.accountsPayable.findUnique({
        where: {
          id: data.accountsPayableId,
        },
      });

    if (!payable) {
      throw new Error('Accounts Payable not found');
    }

    const newPaidAmount =
      payable.paidAmount + data.amountPaid;

    const newBalance =
      payable.outstandingAmount - newPaidAmount;

    const paymentStatus =
      newBalance <= 0 ? 'PAID' : 'PARTIAL';

    return this.prisma.accountsPayable.update({
      where: {
        id: payable.id,
      },
      data: {
        paidAmount: newPaidAmount,
        balanceAmount: newBalance,
        paymentStatus,
      },
    });
  }
}
