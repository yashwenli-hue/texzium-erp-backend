import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAccountsCommercialApprovalDto } from './dto/create-accounts-commercial-approval.dto';

@Injectable()
export class AccountsCommercialApprovalService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateAccountsCommercialApprovalDto) {

    const salesOrder = await this.prisma.salesOrder.findUnique({
      where: {
        id: data.salesOrderId,
      },
    });

    if (!salesOrder) {
      throw new Error('Sales Order not found');
    }

    if (salesOrder.status !== 'PENDING_ACCOUNTS_APPROVAL') {
      throw new Error(
        'Sales Order is not waiting for Accounts Commercial Approval',
      );
    }

    const approval =
      await this.prisma.accountsCommercialApproval.create({
        data: {
          salesOrderId: data.salesOrderId,
          approvedBy: data.approvedBy,
          remarks: data.remarks,
        },
      });

    await this.prisma.salesOrder.update({
      where: {
        id: data.salesOrderId,
      },
      data: {
        status: 'READY_FOR_DISPATCH_ORDER',
      },
    });

    return {
      message:
        'Accounts Commercial Approval completed successfully.',
      approval,
    };
  }

  async findAll() {
    return this.prisma.accountsCommercialApproval.findMany({
      include: {
        salesOrder: true,
      },
    });
  }
}
