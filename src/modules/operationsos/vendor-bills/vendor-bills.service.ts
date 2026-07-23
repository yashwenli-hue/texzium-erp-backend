import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateVendorBillDto } from './dto/create-vendor-bill.dto';

@Injectable()
export class VendorBillsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateVendorBillDto) {
    const grn = await this.prisma.goodsReceipt.findUnique({
      where: { id: data.goodsReceiptId },
    });

    if (!grn) {
      throw new Error('Goods Receipt not found');
    }

    // Create Vendor Bill
    const vendorBill = await this.prisma.vendorBill.create({
      data: {
        goodsReceiptId: data.goodsReceiptId,
        vendorName: data.vendorName,
        billDate: new Date(data.billDate),
        taxableAmount: data.taxableAmount,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        remarks: data.remarks,
      },
    });

    // Fetch required finance accounts
    const purchaseAccount = await this.prisma.chartOfAccount.findFirst({
      where: { accountCode: '4001' },
    });

    const gstInputAccount = await this.prisma.chartOfAccount.findFirst({
      where: { accountCode: '5001' },
    });

    const accountsPayable = await this.prisma.chartOfAccount.findFirst({
      where: { accountCode: '2001' },
    });

    const financialYear = await this.prisma.financialYear.findFirst({
      where: { isClosed: false },
    });

    if (
      !purchaseAccount ||
      !gstInputAccount ||
      !accountsPayable ||
      !financialYear
    ) {
      throw new Error('Finance master setup incomplete');
    }

    // Create Journal Entry
    const journal = await this.prisma.journalEntry.create({
      data: {
        voucherDate: new Date(data.billDate),
        narration: `Auto journal for Vendor Bill ${vendorBill.id}`,
        financialYearId: financialYear.id,
        status: 'POSTED',
      },
    });

    // Journal Lines
    const journalLines = [
      {
        accountId: purchaseAccount.id,
        debitAmount: data.taxableAmount,
        creditAmount: 0,
        remarks: 'Purchase Expense',
      },
      {
        accountId: gstInputAccount.id,
        debitAmount: data.taxAmount,
        creditAmount: 0,
        remarks: 'GST Input',
      },
      {
        accountId: accountsPayable.id,
        debitAmount: 0,
        creditAmount: data.totalAmount,
        remarks: 'Vendor Payable',
      },
    ];

    for (const line of journalLines) {
      await this.prisma.journalLine.create({
        data: {
          journalEntryId: journal.id,
          accountId: line.accountId,
          debitAmount: line.debitAmount,
          creditAmount: line.creditAmount,
          remarks: line.remarks,
        },
      });

      const account = await this.prisma.chartOfAccount.findUnique({
        where: { id: line.accountId },
      });

      if (account) {
        const newBalance =
          account.currentBalance + line.debitAmount - line.creditAmount;

        await this.prisma.chartOfAccount.update({
          where: { id: line.accountId },
          data: {
            currentBalance: newBalance,
          },
        });
      }
    }

        // Create Vendor Ledger Entry
    const lastVendorLedger = await this.prisma.vendorLedger.findFirst({
      where: {
        vendorName: data.vendorName,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const previousBalance = lastVendorLedger
      ? lastVendorLedger.balanceAmount
      : 0;

    const newBalance = previousBalance + data.totalAmount;

    await this.prisma.vendorLedger.create({
      data: {
        vendorName: data.vendorName,
        vendorBillId: vendorBill.id,
        debitAmount: 0,
        creditAmount: data.totalAmount,
        balanceAmount: newBalance,
        entryDate: new Date(data.billDate),
        remarks: `Vendor bill posted ${vendorBill.id}`,
      },
    });

    return vendorBill;
  }

  async findAll() {
    return this.prisma.vendorBill.findMany({
      include: {
        goodsReceipt: true,
      },
    });
  }
}
