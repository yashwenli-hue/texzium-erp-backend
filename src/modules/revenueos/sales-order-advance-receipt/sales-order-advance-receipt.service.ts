import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderAdvanceReceiptDto } from './dto/create-sales-order-advance-receipt.dto';

@Injectable()
export class SalesOrderAdvanceReceiptService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesOrderAdvanceReceiptDto) {
    return this.prisma.salesOrderAdvanceReceipt.create({
      data: {
        salesOrderId: data.salesOrderId,
        receiptDate: new Date(data.receiptDate),
        amountReceived: data.amountReceived,
        paymentMode: data.paymentMode,
        referenceNo: data.referenceNo,
        remarks: data.remarks,
      },
    });
  }

  async findAll() {
    return this.prisma.salesOrderAdvanceReceipt.findMany({
      include: {
        salesOrder: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async verify(id: string, data: any) {
    // 1. Verify Advance Receipt
    const receipt = await this.prisma.salesOrderAdvanceReceipt.update({
      where: {
        id,
      },
      data: {
        verifiedBy: data.verifiedBy,
        verificationStatus: data.verificationStatus,
        verifiedAt: new Date(),
      },
    });

    // 2. Move Sales Order to Accounts Approval Stage
    await this.prisma.salesOrder.update({
      where: {
        id: receipt.salesOrderId,
      },
      data: {
        status: 'PENDING_ACCOUNTS_APPROVAL',
      },
    });

    return {
      message:
        'Advance payment verified. Sales Order moved to Accounts Commercial Approval.',
      receipt,
    };
  }
}
