import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  DOCUMENT_NUMBER_TYPE,
  allocateDocumentNumber,
} from '../../adminos/document-number-series/document-numbering';

export const PAYMENT_COLLECTION_NOT_FOUND_MESSAGE =
  'Payment collection not found.';

@Injectable()
export class ReceiptVouchersService {
  constructor(private prisma: PrismaService) {}

  // The receipt of one payment collection. A payment has at most one receipt:
  // asking again returns the receipt it already has, with its number. The
  // payment row is locked for the transaction, so two requests for the same
  // payment cannot both create one. A new receipt takes the next number of the
  // company's receipt series for the financial year of the payment date
  // (RC/26-27/00001); its amount, date, mode and reference are copied from the
  // payment as recorded.
  async generate(paymentCollectionId: string) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        /* receipt-voucher:lock-payment */
        SELECT "id" FROM "PaymentCollection"
        WHERE "id" = ${paymentCollectionId}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NotFoundException(PAYMENT_COLLECTION_NOT_FOUND_MESSAGE);
      }

      const existing = await tx.receiptVoucher.findUnique({
        where: { paymentCollectionId },
      });

      if (existing) return existing;

      const payment = await tx.paymentCollection.findUniqueOrThrow({
        where: { id: paymentCollectionId },
      });

      const { number } = await allocateDocumentNumber(
        tx,
        DOCUMENT_NUMBER_TYPE.PAYMENT_RECEIPT,
        { kind: 'company' },
        payment.paymentDate,
      );

      return tx.receiptVoucher.create({
        data: {
          receiptNumber: number,
          paymentCollectionId: payment.id,
          receiptDate: payment.paymentDate,
          amountReceived: payment.amount,
          paymentMode: payment.paymentMode,
          referenceNo: payment.referenceNumber,
          remarks: 'Auto generated receipt',
        },
      });
    });
  }

  // The receipts of the payments collected against one sales invoice, oldest
  // first.
  async listForInvoice(salesInvoiceId: string) {
    return this.prisma.receiptVoucher.findMany({
      where: {
        paymentCollection: { accountsReceivable: { salesInvoiceId } },
      },
      orderBy: [{ receiptDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
