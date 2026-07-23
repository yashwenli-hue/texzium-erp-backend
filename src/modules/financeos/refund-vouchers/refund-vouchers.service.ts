import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateRefundVoucherDto } from './dto/create-refund-voucher.dto';

@Injectable()
export class RefundVouchersService {
  constructor(private prisma: PrismaService) {}

  async generate(data: CreateRefundVoucherDto) {
    const creditNote =
      await this.prisma.creditNote.findUnique({
        where: {
          id: data.creditNoteId,
        },
      });

    if (!creditNote) {
      throw new Error('Credit Note not found');
    }

    const refundNumber =
      'RF-' + Math.floor(Math.random() * 1000000);

    return this.prisma.refundVoucher.create({
      data: {
        refundNumber,
        creditNoteId: data.creditNoteId,
        refundDate: new Date(data.refundDate),
        refundAmount: data.refundAmount,
        refundMode: data.refundMode,
        referenceNo: data.referenceNo,
        remarks: 'Customer refund processed',
        status: 'PROCESSED',
      },
    });
  }
}
