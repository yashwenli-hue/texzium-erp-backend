import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateAccountsCommercialApprovalDto } from './dto/create-accounts-commercial-approval.dto';
import { RetractAccountsCommercialApprovalDto } from './dto/retract-accounts-commercial-approval.dto';
import {
  COMMERCIAL_APPROVAL_APPROVED_STATUS,
  COMMERCIAL_APPROVAL_RETRACTED_STATUS,
} from '../sales-orders/sales-order-values';
import {
  SALES_ORDER_EVENT_ACTION,
  SALES_ORDER_EVENT_RESULT,
  SALES_ORDER_STATUS,
  advanceSalesOrder,
  assertLifecycleEvent,
  assertNoDownstreamWork,
  conflictCannotRetract,
  conflictNotWaiting,
  isSalesOrderRetractionAllowed,
  lockSalesOrder,
  recordSalesOrderEvent,
  requireActor,
  requireSalesOrder,
  retractSalesOrder,
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

  // Retracts an approval: READY_FOR_DISPATCH_ORDER ->
  // PENDING_ACCOUNTS_APPROVAL, with a mandatory reason. The approval row is
  // kept and marked RETRACTED (it is no longer in force); a later approval is a
  // new row. Only an approval the workflow recorded (it has its
  // ACCOUNTS_APPROVED event) can be retracted, and never once Operations has a
  // dispatch order or Finance an invoice for the order. Locks are taken in the
  // same order as an advance verification (the record, then the order), and
  // everything is one transaction: a loser of any race gets 409 and leaves
  // nothing behind.
  async retract(
    id: string,
    actorId: string | undefined,
    data: RetractAccountsCommercialApprovalDto,
  ) {
    const actor = await requireActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const approval = await tx.accountsCommercialApproval.findUnique({
        where: { id },
        select: { id: true, salesOrderId: true },
      });

      if (!approval) {
        throw new NotFoundException('Accounts approval not found.');
      }

      const retracted = await tx.accountsCommercialApproval.updateMany({
        where: { id, status: COMMERCIAL_APPROVAL_APPROVED_STATUS },
        data: { status: COMMERCIAL_APPROVAL_RETRACTED_STATUS },
      });

      if (retracted.count === 0) {
        const current = await tx.accountsCommercialApproval.findUnique({
          where: { id },
          select: { status: true },
        });

        if (!current) {
          throw new NotFoundException('Accounts approval not found.');
        }

        throw new ConflictException(
          `This approval is not in force any more (${current.status.toLowerCase().replace(/_/g, ' ')}).`,
        );
      }

      const status = await lockSalesOrder(tx, approval.salesOrderId);
      const to = SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL;

      if (!isSalesOrderRetractionAllowed(status, to)) {
        throw conflictCannotRetract(
          'An accounts approval',
          SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
          status,
        );
      }

      await assertLifecycleEvent(
        tx,
        approval.salesOrderId,
        SALES_ORDER_EVENT_ACTION.ACCOUNTS_APPROVED,
        approval.id,
        'approval',
      );
      await assertNoDownstreamWork(tx, approval.salesOrderId, 'retract');

      const moved = await retractSalesOrder(
        tx,
        approval.salesOrderId,
        SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
        to,
      );

      if (!moved) {
        const order = await requireSalesOrder(tx, approval.salesOrderId);
        throw conflictCannotRetract(
          'An accounts approval',
          SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
          order.status,
        );
      }

      await recordSalesOrderEvent(tx, {
        salesOrderId: approval.salesOrderId,
        action: SALES_ORDER_EVENT_ACTION.ACCOUNTS_APPROVAL_RETRACTED,
        result: SALES_ORDER_EVENT_RESULT.RETRACTED,
        fromStatus: SALES_ORDER_STATUS.READY_FOR_DISPATCH_ORDER,
        toStatus: to,
        referenceId: approval.id,
        remarks: data.reason,
        actorId: actor.id,
        occurredAt: now,
      });

      return {
        message:
          'Accounts approval retracted. The Sales Order is waiting for Accounts Commercial Approval again.',
        approval: await tx.accountsCommercialApproval.findUnique({
          where: { id },
        }),
        salesOrder: { id: approval.salesOrderId, status: to },
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
