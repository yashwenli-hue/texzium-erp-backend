import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';

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

      // 3. Auto derive tax
      const taxableAmount = salesOrder.totalAmount;
      let gstAmount = 0;
      let cgstAmount = 0;
      let sgstAmount = 0;
      let igstAmount = 0;

      // Assume 18% based on sales order flow
      gstAmount = (taxableAmount * 18) / 100;

      if (salesOrder.taxType === 'IGST') {
        igstAmount = gstAmount;
      }

      if (salesOrder.taxType === 'CGST_SGST') {
        cgstAmount = gstAmount / 2;
        sgstAmount = gstAmount / 2;
      }

      const totalAmount = taxableAmount + gstAmount;

      // 4. Create Sales Invoice
      const salesInvoice = await this.prisma.salesInvoice.create({
        data: {
          salesOrderId: data.salesOrderId,
          dispatchOrderId: data.dispatchOrderId,
          invoiceDate: new Date(data.invoiceDate),
          customerName: data.customerName,

          taxableAmount,
          gstAmount,
          cgstAmount,
          sgstAmount,
          igstAmount,
          totalAmount,

          remarks: data.remarks,
          status: 'POSTED',
        },
      });

      // 5. Accounts Receivable
      await this.prisma.accountsReceivable.create({
        data: {
          salesInvoiceId: salesInvoice.id,
          dueDate: new Date(data.invoiceDate),
          outstandingAmount: totalAmount,
          paidAmount: 0,
          balanceAmount: totalAmount,
          paymentStatus: 'PENDING',
        },
      });

      // 6. Customer Ledger
      const lastCustomerLedger =
        await this.prisma.customerLedger.findFirst({
          where: {
            customerName: data.customerName,
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
          customerName: data.customerName,
          salesInvoiceId: salesInvoice.id,
          debitAmount: totalAmount,
          creditAmount: 0,
          balanceAmount: newBalance,
          entryDate: new Date(data.invoiceDate),
          remarks: `Sales invoice posted ${salesInvoice.id}`,
        },
      });

      // 7. Finance Accounts
      const receivableAccount =
        await this.prisma.chartOfAccount.findFirst({
          where: { accountCode: '1101' },
        });

      const salesAccount =
        await this.prisma.chartOfAccount.findFirst({
          where: { accountCode: '3001' },
        });

      const gstOutputAccount =
        await this.prisma.chartOfAccount.findFirst({
          where: { accountCode: '5002' },
        });

      const financialYear =
        await this.prisma.financialYear.findFirst({
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
          voucherDate: new Date(data.invoiceDate),
          narration: `Auto journal for Sales Invoice ${salesInvoice.id}`,
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

  async findAll() {
    return this.prisma.salesInvoice.findMany({
      include: {
        salesOrder: true,
        dispatchOrder: true,
        receivables: true,
        customerLedgerEntries: true,
      },
    });
  }
}
