import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateDebitNoteDto } from './dto/create-debit-note.dto';

@Injectable()
export class DebitNotesService {
  constructor(private prisma: PrismaService) {}

  async generate(data: CreateDebitNoteDto) {
    const invoice =
      await this.prisma.salesInvoice.findUnique({
        where: {
          id: data.salesInvoiceId,
        },
      });

    if (!invoice) {
      throw new Error('Sales Invoice not found');
    }

    const debitNoteNo =
      'DN-' + Math.floor(Math.random() * 1000000);

    // Increase AR
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
            receivable.outstandingAmount + data.totalAmount,
          balanceAmount:
            receivable.balanceAmount + data.totalAmount,
        },
      });
    }

    // Customer Ledger Debit Adjustment
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
      previousBalance + data.totalAmount;

    await this.prisma.customerLedger.create({
      data: {
        customerName: invoice.customerName!,
        salesInvoiceId: invoice.id,
        debitAmount: data.totalAmount,
        creditAmount: 0,
        balanceAmount: newBalance,
        entryDate: new Date(data.noteDate),
        remarks: `Debit Note ${debitNoteNo}`,
      },
    });

    return this.prisma.debitNote.create({
      data: {
        debitNoteNo,
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
