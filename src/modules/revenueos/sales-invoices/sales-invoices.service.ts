import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import {
  SALES_ORDER_NOT_FOUND_MESSAGE,
  SALES_ORDER_STATUS,
} from '../sales-orders/sales-order-lifecycle';
import {
  fromPaise,
  toPaise,
} from '../payment-collections/payment-collection-values';
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
export const DISPATCH_ORDER_NOT_FOUND_MESSAGE =
  'Dispatch Order not found. No invoice was created.';
export const DISPATCH_ORDER_OF_ANOTHER_ORDER_MESSAGE =
  'This Dispatch Order is not a dispatch of this Sales Order. Invoice an order against its own Dispatch Order; no invoice was created.';
export const DISPATCH_ORDER_NOT_DISPATCHED_MESSAGE =
  'The Dispatch Order has not been dispatched yet. An order is invoiced once its Dispatch Order is DISPATCHED; no invoice was created.';
export const FINANCE_SETUP_INCOMPLETE_MESSAGE =
  'Finance master setup incomplete.';

const RECEIVABLE_ACCOUNT_CODE = '1101';
const SALES_ACCOUNT_CODE = '3001';
const GST_OUTPUT_ACCOUNT_CODE = '5002';

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLowerCase() ===
  b.trim().replace(/\s+/g, ' ').toLowerCase();

@Injectable()
export class SalesInvoicesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesInvoiceDto) {
    try {
      // 1. The Dispatch Order exists.
      const dispatchOrder = await this.prisma.dispatchOrder.findUnique({
        where: { id: data.dispatchOrderId },
      });

      if (!dispatchOrder) {
        throw new NotFoundException(DISPATCH_ORDER_NOT_FOUND_MESSAGE);
      }

      // 2. The Sales Order exists.
      const salesOrder = await this.prisma.salesOrder.findUnique({
        where: { id: data.salesOrderId },
      });

      if (!salesOrder) {
        throw new NotFoundException(SALES_ORDER_NOT_FOUND_MESSAGE);
      }

      // 3. The Dispatch Order is this Sales Order's, and it has gone out. A
      // dispatch of another order (or one not made from an order) cannot be
      // invoiced against this one.
      if (dispatchOrder.salesOrderId !== data.salesOrderId) {
        throw new BadRequestException(DISPATCH_ORDER_OF_ANOTHER_ORDER_MESSAGE);
      }

      if (dispatchOrder.status !== 'DISPATCHED') {
        throw new ConflictException(DISPATCH_ORDER_NOT_DISPATCHED_MESSAGE);
      }

      // 4. The invoice date: a calendar day, not after today in India.
      if (data.invoiceDate > istCalendarDay(new Date())) {
        throw new BadRequestException(
          'The invoice date cannot be later than today (India time).',
        );
      }
      const invoiceDate = new Date(`${data.invoiceDate}T00:00:00.000Z`);

      // 5. The finance masters the journal posts to, checked before anything
      // is written or numbered: receivables (1101), sales (3001), GST output
      // (5002) and an open financial year.
      const finance = await this.loadFinanceMasters();

      // 6. The invoice and everything it posts, in one transaction that holds
      // the order exclusively: the order is not cancelled and not invoiced
      // yet, every amount is its Quotation's (nothing is added on top), the
      // number is the next of the seller registration's series, and the
      // invoice's lines are the priced lines it was sold with. Its receivable,
      // customer-ledger entry and journal are written in the same transaction.
      // If anything fails, nothing is written and the number is given back.
      const { salesInvoice } = await this.prisma.$transaction(async (tx) => {
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

        // 7. Accounts Receivable: the whole invoice is outstanding.
        await tx.accountsReceivable.create({
          data: {
            salesInvoiceId: invoice.id,
            dueDate: invoiceDate,
            outstandingAmount: invoice.totalAmount,
            paidAmount: 0,
            balanceAmount: invoice.totalAmount,
            paymentStatus: 'PENDING',
          },
        });

        // 8. Customer Ledger: one debit entry with the running balance of
        // this customer's ledger. Serialised on the same lock payment
        // collections take, so an invoice and a payment of the same customer
        // cannot both read the same previous balance.
        const ledgerName = plan.customer.customerName;
        await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(hashtextextended(${`customer-ledger:${ledgerName}`}, 0))
          `;

        const lastLedger = await tx.customerLedger.findFirst({
          where: { customerName: ledgerName },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { balanceAmount: true },
        });

        await tx.customerLedger.create({
          data: {
            customerName: ledgerName,
            salesInvoiceId: invoice.id,
            debitAmount: invoice.totalAmount,
            creditAmount: 0,
            balanceAmount: fromPaise(
              toPaise(lastLedger?.balanceAmount ?? 0) +
                toPaise(invoice.totalAmount),
            ),
            entryDate: invoiceDate,
            remarks: `Sales invoice posted ${invoice.invoiceNumber}`,
            // Set after the lock is held, so "latest row" follows lock order.
            createdAt: new Date(),
          },
        });

        // 9. Journal: receivable debit = sales credit + GST output credit.
        const journal = await tx.journalEntry.create({
          data: {
            voucherDate: invoiceDate,
            narration: `Auto journal for Sales Invoice ${invoice.invoiceNumber}`,
            financialYearId: finance.financialYearId,
            status: 'POSTED',
          },
        });

        const journalLines = [
          {
            accountId: finance.receivableAccountId,
            debitAmount: invoice.totalAmount,
            creditAmount: 0,
          },
          {
            accountId: finance.salesAccountId,
            debitAmount: 0,
            creditAmount: invoice.taxableAmount,
          },
          {
            accountId: finance.gstOutputAccountId,
            debitAmount: 0,
            creditAmount: invoice.gstAmount,
          },
        ];

        for (const line of journalLines) {
          await tx.journalLine.create({
            data: { journalEntryId: journal.id, ...line },
          });
        }

        return { salesInvoice: invoice };
      });

      return salesInvoice;
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  // The accounts and financial year an invoice's journal posts to, or a 409
  // that names what is missing. Read before the invoice transaction so a
  // missing master refuses the invoice before a number is used.
  private async loadFinanceMasters() {
    const [receivable, sales, gstOutput, financialYear] = await Promise.all([
      this.prisma.chartOfAccount.findFirst({
        where: { accountCode: RECEIVABLE_ACCOUNT_CODE },
      }),
      this.prisma.chartOfAccount.findFirst({
        where: { accountCode: SALES_ACCOUNT_CODE },
      }),
      this.prisma.chartOfAccount.findFirst({
        where: { accountCode: GST_OUTPUT_ACCOUNT_CODE },
      }),
      this.prisma.financialYear.findFirst({ where: { isClosed: false } }),
    ]);

    const missing = [
      !receivable && `account ${RECEIVABLE_ACCOUNT_CODE} (receivables)`,
      !sales && `account ${SALES_ACCOUNT_CODE} (sales)`,
      !gstOutput && `account ${GST_OUTPUT_ACCOUNT_CODE} (GST output)`,
      !financialYear && 'an open financial year',
    ].filter(Boolean);

    if (!receivable || !sales || !gstOutput || !financialYear) {
      throw new ConflictException(
        `${FINANCE_SETUP_INCOMPLETE_MESSAGE} Missing: ${missing.join(', ')}. No invoice was created.`,
      );
    }

    return {
      receivableAccountId: receivable.id,
      salesAccountId: sales.id,
      gstOutputAccountId: gstOutput.id,
      financialYearId: financialYear.id,
    };
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
