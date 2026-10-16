import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { SALES_ORDER_STATUS } from '../sales-orders/sales-order-lifecycle';
import { istCalendarDay } from '../../../core/dates/ist';
import {
  DOCUMENT_NUMBER_TYPE,
  allocateDocumentNumber,
} from '../../adminos/document-number-series/document-numbering';
import { lockSalesOrderForInvoice } from './invoice-order-lock';
import { loadInvoiceSource, planInvoice } from './invoice-source';
import { loadDocumentIssuer } from '../../adminos/document-profile/document-identity';
import { resolveOrderParties } from '../documents/revenue-document-parts';
import {
  InvoiceDocumentData,
  invoiceDocumentBlockers,
} from './invoice-document';
import {
  ALL_RECORDS,
  RecordScope,
  salesInvoiceWhere,
} from '../record-scope/record-scope';

export const ALREADY_INVOICED_MESSAGE =
  'This Sales Order has already been invoiced. An order is invoiced once, for its full value; no invoice was created.';

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() ===
  b.trim().replace(/\s+/g, ' ').toLowerCase();

@Injectable()
export class SalesInvoicesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesInvoiceDto) {
    try {
      // 1. Validate Dispatch Order
      const dispatchOrder = await this.prisma.dispatchOrder.findUnique({
        where: { id: data.dispatchOrderId },
      });

      if (!dispatchOrder || dispatchOrder.status !== 'DISPATCHED') {
        throw new Error('Dispatch Order must be DISPATCHED');
      }

      // 2. Validate Sales Order
      const salesOrder = await this.prisma.salesOrder.findUnique({
        where: { id: data.salesOrderId },
      });

      if (!salesOrder) {
        throw new Error('Sales Order not found');
      }

      // 3. The invoice date: a calendar day, not after today in India.
      if (data.invoiceDate > istCalendarDay(new Date())) {
        throw new BadRequestException(
          'The invoice date cannot be later than today (India time).',
        );
      }
      const invoiceDate = new Date(`${data.invoiceDate}T00:00:00.000Z`);

      // 4. The invoice itself, in one transaction that holds the order
      // exclusively: the order is not cancelled and not invoiced yet, every
      // amount is its Quotation's (nothing is added on top), the number is the
      // next of the seller registration's series, and the invoice's lines are
      // the priced lines it was sold with. If anything fails, nothing is
      // written and the number is given back.
      const { salesInvoice, plan } = await this.prisma.$transaction(
        async (tx) => {
          const status = await lockSalesOrderForInvoice(tx, data.salesOrderId);

          if (status === SALES_ORDER_STATUS.CANCELLED) {
            throw new ConflictException(
              'A cancelled Sales Order cannot be invoiced.',
            );
          }

          if (
            (await tx.salesInvoice.count({
              where: { salesOrderId: data.salesOrderId },
            })) > 0
          ) {
            throw new ConflictException(ALREADY_INVOICED_MESSAGE);
          }

          const plan = planInvoice(
            await loadInvoiceSource(tx, data.salesOrderId),
          );

          if (
            data.customerName !== undefined &&
            !sameName(data.customerName, plan.customer.customerName)
          ) {
            throw new BadRequestException(
              `The customer name does not match the Sales Order's customer (${plan.customer.customerName}).`,
            );
          }

          const allocated = await allocateDocumentNumber(
            tx,
            DOCUMENT_NUMBER_TYPE.SALES_INVOICE,
            {
              kind: 'registration',
              gstRegistrationId: plan.seller.id,
              stateCode: plan.seller.stateCode,
            },
            invoiceDate,
          );

          // Numbers follow dates: an invoice cannot be dated before the latest
          // invoice already numbered in its series.
          const latest = await tx.salesInvoice.findFirst({
            where: { invoiceNumber: { startsWith: allocated.prefix } },
            orderBy: [{ invoiceDate: 'desc' }],
            select: { invoiceNumber: true, invoiceDate: true },
          });
          if (latest && latest.invoiceDate.getTime() > invoiceDate.getTime()) {
            throw new ConflictException(
              `The invoice date ${data.invoiceDate} is earlier than invoice ${latest.invoiceNumber} (${istCalendarDay(latest.invoiceDate)}) in the same series. Invoices are numbered in date order; no invoice was created.`,
            );
          }

          const invoice = await tx.salesInvoice.create({
            data: {
              invoiceNumber: allocated.number,
              salesOrderId: data.salesOrderId,
              dispatchOrderId: data.dispatchOrderId,
              invoiceDate,
              customerName: plan.customer.customerName,

              taxableAmount: plan.taxableAmount,
              gstAmount: plan.gstAmount,
              cgstAmount: plan.cgstAmount,
              sgstAmount: plan.sgstAmount,
              igstAmount: plan.igstAmount,
              totalAmount: plan.totalAmount,

              remarks: data.remarks,
              status: 'POSTED',
            },
          });

          if (plan.lines.length > 0) {
            await tx.salesInvoiceItem.createMany({
              data: plan.lines.map((line) => ({
                salesInvoiceId: invoice.id,
                sourceLineId: line.id,
                lineNumber: line.lineNumber,
                productId: line.inventoryItemId as string,
                description: line.description,
                hsnCode: line.hsnCode,
                quantity: line.quantity,
                rate: line.unitRate,
                taxableAmount: line.taxableAmount,
                gstRate: line.gstRate,
                cgstAmount: line.cgstAmount,
                sgstAmount: line.sgstAmount,
                igstAmount: line.igstAmount,
                gstAmount: line.gstAmount,
                totalAmount: line.totalAmount,
              })),
            });
          }

          return { salesInvoice: invoice, plan };
        },
      );

      const { taxableAmount, gstAmount, totalAmount } = salesInvoice;
      const customerName = plan.customer.customerName;

      // 5. Accounts Receivable
      await this.prisma.accountsReceivable.create({
        data: {
          salesInvoiceId: salesInvoice.id,
          dueDate: invoiceDate,
          outstandingAmount: totalAmount,
          paidAmount: 0,
          balanceAmount: totalAmount,
          paymentStatus: 'PENDING',
        },
      });

      // 6. Customer Ledger
      const lastCustomerLedger = await this.prisma.customerLedger.findFirst({
        where: {
          customerName,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      const previousBalance = lastCustomerLedger
        ? lastCustomerLedger.balanceAmount
        : 0;

      const newBalance = previousBalance + totalAmount;

      await this.prisma.customerLedger.create({
        data: {
          customerName,
          salesInvoiceId: salesInvoice.id,
          debitAmount: totalAmount,
          creditAmount: 0,
          balanceAmount: newBalance,
          entryDate: invoiceDate,
          remarks: `Sales invoice posted ${salesInvoice.invoiceNumber}`,
        },
      });

      // 7. Finance Accounts
      const receivableAccount = await this.prisma.chartOfAccount.findFirst({
        where: { accountCode: '1101' },
      });

      const salesAccount = await this.prisma.chartOfAccount.findFirst({
        where: { accountCode: '3001' },
      });

      const gstOutputAccount = await this.prisma.chartOfAccount.findFirst({
        where: { accountCode: '5002' },
      });

      const financialYear = await this.prisma.financialYear.findFirst({
        where: { isClosed: false },
      });

      if (
        !receivableAccount ||
        !salesAccount ||
        !gstOutputAccount ||
        !financialYear
      ) {
        throw new Error('Finance master setup incomplete');
      }

      // 8. Journal Entry
      const journal = await this.prisma.journalEntry.create({
        data: {
          voucherDate: invoiceDate,
          narration: `Auto journal for Sales Invoice ${salesInvoice.invoiceNumber}`,
          financialYearId: financialYear.id,
          status: 'POSTED',
        },
      });

      const journalLines = [
        {
          accountId: receivableAccount.id,
          debitAmount: totalAmount,
          creditAmount: 0,
        },
        {
          accountId: salesAccount.id,
          debitAmount: 0,
          creditAmount: taxableAmount,
        },
        {
          accountId: gstOutputAccount.id,
          debitAmount: 0,
          creditAmount: gstAmount,
        },
      ];

      for (const line of journalLines) {
        await this.prisma.journalLine.create({
          data: {
            journalEntryId: journal.id,
            accountId: line.accountId,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
          },
        });
      }

      return salesInvoice;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  // Everything the tax invoice document prints, read as stored, or a 409 that
  // says why this invoice cannot be printed as a tax invoice.
  async documentData(id: string): Promise<InvoiceDocumentData> {
    const invoice = await this.prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        SalesInvoiceItem: {
          orderBy: [{ lineNumber: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!invoice) throw new NotFoundException('Sales invoice not found.');

    const parties = await resolveOrderParties(
      this.prisma,
      invoice.salesOrderId,
    );
    const data: InvoiceDocumentData = {
      invoice,
      items: invoice.SalesInvoiceItem.map((i) => ({
        lineNumber: i.lineNumber,
        description: i.description,
        hsnCode: i.hsnCode,
        quantity: i.quantity,
        unitRate: i.rate,
        taxableAmount: i.taxableAmount,
        gstRate: i.gstRate,
        cgstAmount: i.cgstAmount,
        sgstAmount: i.sgstAmount,
        igstAmount: i.igstAmount,
        gstAmount: i.gstAmount,
        totalAmount: i.totalAmount,
      })),
      order: parties,
      customer: parties?.customer ?? null,
      buyer: parties?.buyer ?? null,
      issuer: await loadDocumentIssuer(
        this.prisma,
        parties?.sellerGstId ?? null,
      ),
      generatedAt: new Date(),
    };

    const blockers = invoiceDocumentBlockers(data);
    if (blockers.length > 0) {
      throw new ConflictException(
        `This invoice cannot be printed as a tax invoice: ${blockers.join('; ')}.`,
      );
    }
    return data;
  }

  async findAll(scope: RecordScope = ALL_RECORDS) {
    return this.prisma.salesInvoice.findMany({
      where: salesInvoiceWhere(scope),
      include: {
        salesOrder: true,
        dispatchOrder: true,
        receivables: true,
        customerLedgerEntries: true,
        SalesInvoiceItem: {
          orderBy: [{ lineNumber: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
  }
}
