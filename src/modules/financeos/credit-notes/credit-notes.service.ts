import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';

@Injectable()
export class CreditNotesService {
  constructor(private prisma: PrismaService) {}

  async generate(data: CreateCreditNoteDto) {
    const invoice =
      await this.prisma.salesInvoice.findUnique({
        where: {
          id: data.salesInvoiceId,
        },
      });

    if (!invoice) {
      throw new Error('Sales Invoice not found');
    }

    const creditNoteNo =
      'CN-' + Math.floor(Math.random() * 1000000);

    const receivable =
      await this.prisma.accountsReceivable.findFirst({
        where: {
          salesInvoiceId: invoice.id,
        },
      });

    if (receivable) {
      await this.prisma.accountsReceivable.update({
        where: {
          id: receivable.id,
        },
        data: {
          outstandingAmount:
            receivable.outstandingAmount - data.totalAmount,
          balanceAmount:
            receivable.balanceAmount - data.totalAmount,
        },
      });
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

    const newBalance =
      previousBalance - data.totalAmount;

    await this.prisma.customerLedger.create({
      data: {
        customerName: invoice.customerName!,
        salesInvoiceId: invoice.id,
        debitAmount: 0,
        creditAmount: data.totalAmount,
        balanceAmount: newBalance,
        entryDate: new Date(data.noteDate),
        remarks: `Credit Note ${creditNoteNo}`,
      },
    });

    return this.prisma.creditNote.create({
      data: {
        creditNoteNo,
        salesInvoiceId: data.salesInvoiceId,
        noteDate: new Date(data.noteDate),
        reason: data.reason,
        taxableAmount: data.taxableAmount,
        gstAmount: data.gstAmount,
        totalAmount: data.totalAmount,
        status: 'POSTED',
      },
    });
  }
}
