import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateBadDebtWriteOffDto } from './dto/create-bad-debt-writeoff.dto';

@Injectable()
export class BadDebtWriteOffService {
  constructor(private prisma: PrismaService) {}

  async generate(data: CreateBadDebtWriteOffDto) {
    const receivable =
      await this.prisma.accountsReceivable.findUnique({
        where: {
          id: data.accountsReceivableId,
        },
      });

    if (!receivable) {
      throw new Error('Accounts Receivable not found');
    }

    const writeOffNumber =
      'BD-' + Math.floor(Math.random() * 1000000);

    // Close AR
    await this.prisma.accountsReceivable.update({
      where: {
        id: receivable.id,
      },
      data: {
        balanceAmount:
          receivable.balanceAmount - data.writeOffAmount,
        paymentStatus: 'WRITTEN_OFF',
      },
    });

    return this.prisma.badDebtWriteOff.create({
      data: {
        writeOffNumber,
        accountsReceivableId: data.accountsReceivableId,
        writeOffDate: new Date(data.writeOffDate),
        writeOffAmount: data.writeOffAmount,
        reason: data.reason,
        approvedBy: data.approvedBy,
        status: 'APPROVED',
      },
    });
  }
}
