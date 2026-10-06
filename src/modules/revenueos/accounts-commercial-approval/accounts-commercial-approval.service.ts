import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAccountsCommercialApprovalDto } from './dto/create-accounts-commercial-approval.dto';
import {
  SALES_ORDER_EVENT_ACTION,
  SALES_ORDER_EVENT_RESULT,
  SALES_ORDER_STATUS,
  advanceSalesOrder,
  conflictNotWaiting,
  recordSalesOrderEvent,
  requireActor,
  requireSalesOrder,
} from '../sales-orders/sales-order-lifecycle';

@Injectable()
export class AccountsCommercialApprovalService {
  constructor(private prisma: PrismaService) {}

  // Gives Accounts commercial approval: PENDING_ACCOUNTS_APPROVAL ->
  // READY_FOR_DISPATCH_ORDER, and nothing else. The status change is a
  // conditional update inside the same transaction as the approval record and
  // its event, so two requests racing cannot both approve one order: the loser
  // gets 409 and leaves no approval behind.
  async create(
    data: CreateAccountsCommercialApprovalDto,
    actorId: string | undefined,
  ) {
    const actor = await requireActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const moved = await advanceSalesOrder(
        tx,
        data.salesOrderId,
        SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
        SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
      );

      if (!moved) {
        // Either there is no such order (404) or it is in another status (409).
        const order = await requireSalesOrder(tx, data.salesOrderId);
        throw conflictNotWaiting('Accounts Commercial Approval', order.status);
      }

      const approval = await tx.accountsCommercialApproval.create({
        data: {
          salesOrderId: data.salesOrderId,
          // Legacy text column, kept readable for old reports. The actor of
          // record is SalesOrderEvent.actorId.
          approvedBy: actor.fullName,
          remarks: data.remarks,
        },
      });

      await recordSalesOrderEvent(tx, {
        salesOrderId: data.salesOrderId,
        action: SALES_ORDER_EVENT_ACTION.ACCOUNTS_APPROVED,
        result: SALES_ORDER_EVENT_RESULT.APPROVED,
        fromStatus: SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
        toStatus: SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
        referenceId: approval.id,
        remarks: data.remarks,
        actorId: actor.id,
        occurredAt: now,
      });

      return {
        message: 'Accounts Commercial Approval completed successfully.',
        approval,
        salesOrder: {
          id: data.salesOrderId,
          status: SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
        },
      };
    });
  }

  async findAll() {
    return this.prisma.accountsCommercialApproval.findMany({
      include: {
        salesOrder: true,
      },
    });
  }
}
