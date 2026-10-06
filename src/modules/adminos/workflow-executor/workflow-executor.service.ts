import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class WorkflowExecutorService {
  constructor(private prisma: PrismaService) {}

  async execute(payload: any) {
    const { trigger, referenceId } = payload;

    // Retired: this trigger used to create a Sales Order straight from an
    // approved Quotation, outside the Sales Order lifecycle. A Sales Order is
    // now created only from an approved Proforma Invoice (POST /sales-orders),
    // so this does nothing and writes nothing.
    if (trigger === 'QUOTATION_APPROVED') {
      return {
        success: false,
        action: 'NONE',
        referenceId,
        message:
          'Sales Orders are no longer created by workflow. Create a Proforma Invoice from the approved Quotation, then a Sales Order from the approved Proforma Invoice.',
      };
    }

    if (trigger === 'QUALITY_INSPECTION_APPROVED') {
      const qualityInspection =
        await this.prisma.qualityInspection.findUnique({
          where: { id: referenceId },
          include: {
            goodsReceipt: true,
          },
        });

      if (!qualityInspection) {
        return {
          success: false,
          message: 'Quality Inspection not found',
        };
      }

      const vendorBill =
        await this.prisma.vendorBill.create({
          data: {
            goodsReceiptId: qualityInspection.goodsReceiptId,
            vendorName: 'AUTO GENERATED VENDOR',
            billDate: new Date(),
            taxableAmount: qualityInspection.acceptedQty * 1000,
            taxAmount: qualityInspection.acceptedQty * 180,
            totalAmount: qualityInspection.acceptedQty * 1180,
            remarks:
              'Auto-created by workflow engine after QI approval',
          },
        });

      return {
        success: true,
        action: 'CREATE_VENDOR_BILL',
        referenceId,
        vendorBill,
        message:
          'Workflow executed: Vendor Bill auto-created',
      };
    }

    if (trigger === 'VENDOR_BILL_CREATED') {
      const vendorBill =
        await this.prisma.vendorBill.findUnique({
          where: { id: referenceId },
        });

      if (!vendorBill) {
        return {
          success: false,
          message: 'Vendor Bill not found',
        };
      }

      const payable =
        await this.prisma.accountsPayable.create({
          data: {
            vendorBillId: vendorBill.id,
            vendorName: vendorBill.vendorName,
            dueDate: new Date(),
            outstandingAmount: vendorBill.totalAmount,
            paidAmount: 0,
            balanceAmount: vendorBill.totalAmount,
            paymentStatus: 'PENDING',
          },
        });

      const financialYear =
        await this.prisma.financialYear.findFirst({
          orderBy: {
            createdAt: 'desc',
          },
        });

      const journalEntry =
        await this.prisma.journalEntry.create({
          data: {
            voucherDate: new Date(),
            narration:
              `Auto journal for Vendor Bill ${vendorBill.id}`,
            financialYearId: financialYear!.id,
            status: 'POSTED',
          },
        });

      await this.prisma.journalLine.createMany({
        data: [
          {
            journalEntryId: journalEntry.id,
            accountId: '09efd689-cfa6-4d01-b358-1b3770b4eff3',
            debitAmount: vendorBill.taxableAmount,
            creditAmount: 0,
            remarks: 'Purchase Expense',
          },
          {
            journalEntryId: journalEntry.id,
            accountId: 'b2d10770-1ae5-43d5-aed5-d7a9bfeefae9',
            debitAmount: vendorBill.taxAmount,
            creditAmount: 0,
            remarks: 'GST Input',
          },
          {
            journalEntryId: journalEntry.id,
            accountId: 'eaf84cb4-d74b-4157-8004-cde5acf8deda',
            debitAmount: 0,
            creditAmount: vendorBill.totalAmount,
            remarks: 'Vendor Payable',
          },
        ],
      });

      return {
        success: true,
        action: 'CREATE_ACCOUNTS_PAYABLE_AND_JOURNAL',
        referenceId,
        payable,
        journalEntry,
        message:
          'Workflow executed: AP + Journal auto-created',
      };
    }

    return {
      success: false,
      message: 'No workflow matched',
    };
  }
}
