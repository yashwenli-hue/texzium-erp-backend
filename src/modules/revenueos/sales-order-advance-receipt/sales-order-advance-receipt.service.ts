import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderAdvanceReceiptDto } from './dto/create-sales-order-advance-receipt.dto';
import { VerifySalesOrderAdvanceReceiptDto } from './dto/verify-sales-order-advance-receipt.dto';
import { RetractSalesOrderAdvanceReceiptVerificationDto } from './dto/retract-sales-order-advance-receipt-verification.dto';
import {
  ADVANCE_RECEIPT_PENDING_STATUS,
  ADVANCE_RECEIPT_VERIFIED_STATUS,
} from '../sales-orders/sales-order-values';
import {
  SALES_ORDER_EVENT_ACTION,
  SALES_ORDER_EVENT_RESULT,
  SALES_ORDER_STATUS,
  advanceSalesOrder,
  assertLifecycleEvent,
  assertNoDownstreamWork,
  canRecordSalesOrderDocuments,
  conflictCannotRetract,
  conflictNotAcceptingDocuments,
  conflictNotWaiting,
  isSalesOrderRetractionAllowed,
  lockSalesOrder,
  readSalesOrderStatusShared,
  recordSalesOrderEvent,
  requireActor,
  requireSalesOrder,
  retractSalesOrder,
} from '../sales-orders/sales-order-lifecycle';
import {
  ALL_RECORDS,
  RecordScope,
  salesOrderChildWhere,
} from '../record-scope/record-scope';

@Injectable()
export class SalesOrderAdvanceReceiptService {
  constructor(private prisma: PrismaService) {}

  // An advance receipt can only be recorded while the order is waiting for
  // store or accounts approval. The order's status is read under a shared row
  // lock, so a cancellation (or an approval) cannot commit between the check
  // and the insert; the other way round, the receipt is written first and the
  // cancellation sees it.
  async create(data: CreateSalesOrderAdvanceReceiptDto) {
    return this.prisma.$transaction(async (tx) => {
      const status = await readSalesOrderStatusShared(tx, data.salesOrderId);

      if (!canRecordSalesOrderDocuments(status)) {
        throw conflictNotAcceptingDocuments('advance receipts', status);
      }

      return tx.salesOrderAdvanceReceipt.create({
        data: {
          salesOrderId: data.salesOrderId,
          receiptDate: new Date(data.receiptDate),
          amountReceived: data.amountReceived,
          paymentMode: data.paymentMode,
          referenceNo: data.referenceNo,
          remarks: data.remarks,
        },
      });
    });
  }

  async findAll(scope: RecordScope = ALL_RECORDS) {
    return this.prisma.salesOrderAdvanceReceipt.findMany({
      where: salesOrderChildWhere(scope),
      include: {
        salesOrder: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Verifies or rejects a pending advance receipt, in one transaction.
  //
  // VERIFIED moves the Sales Order PENDING_STORE_APPROVAL ->
  // PENDING_ACCOUNTS_APPROVAL. REJECTED leaves the order where it is and is
  // recorded as an event only. Both conditional updates (the receipt must still
  // be PENDING, the order must still be in the expected status) are atomic, so
  // two requests racing cannot decide one receipt twice or advance one order
  // twice; the loser gets 409 and nothing of its work is kept.
  async verify(
    id: string,
    actorId: string | undefined,
    data: VerifySalesOrderAdvanceReceiptDto,
  ) {
    const actor = await requireActor(this.prisma, actorId);
    const outcome = data.verificationStatus;

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const receipt = await tx.salesOrderAdvanceReceipt.findUnique({
        where: { id },
        select: { id: true, salesOrderId: true },
      });

      if (!receipt) {
        throw new NotFoundException('Advance receipt not found.');
      }

      const decided = await tx.salesOrderAdvanceReceipt.updateMany({
        where: { id, verificationStatus: 'PENDING' },
        data: {
          verificationStatus: outcome,
          // Legacy text columns, kept readable for old reports. The actor of
          // record is SalesOrderEvent.actorId.
          verifiedBy: actor.fullName,
          verifiedAt: now,
        },
      });

      if (decided.count === 0) {
        const current = await tx.salesOrderAdvanceReceipt.findUnique({
          where: { id },
          select: { verificationStatus: true },
        });

        if (!current) {
          throw new NotFoundException('Advance receipt not found.');
        }

        throw new ConflictException(
          `This advance receipt has already been decided (${current.verificationStatus.toLowerCase().replace(/_/g, ' ')}).`,
        );
      }

      if (outcome === SALES_ORDER_EVENT_RESULT.VERIFIED) {
        const moved = await advanceSalesOrder(
          tx,
          receipt.salesOrderId,
          SALES_ORDER_STATUS.PENDING_STORE_APPROVAL,
          SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
        );

        if (!moved) {
          const order = await requireSalesOrder(tx, receipt.salesOrderId);
          throw conflictNotWaiting(
            'advance payment verification',
            order.status,
          );
        }

        await recordSalesOrderEvent(tx, {
          salesOrderId: receipt.salesOrderId,
          action: SALES_ORDER_EVENT_ACTION.ADVANCE_RECEIPT_VERIFIED,
          result: SALES_ORDER_EVENT_RESULT.VERIFIED,
          fromStatus: SALES_ORDER_STATUS.PENDING_STORE_APPROVAL,
          toStatus: SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
          referenceId: receipt.id,
          remarks: data.remarks,
          actorId: actor.id,
          occurredAt: now,
        });

        return {
          message:
            'Advance payment verified. Sales Order moved to Accounts Commercial Approval.',
          receipt: await tx.salesOrderAdvanceReceipt.findUnique({
            where: { id },
          }),
          salesOrder: {
            id: receipt.salesOrderId,
            status: SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
          },
        };
      }

      // REJECTED: the order does not move. A cancelled order accepts no more
      // decisions: its pending receipts stay as they are.
      const status = await readSalesOrderStatusShared(tx, receipt.salesOrderId);

      if (status === SALES_ORDER_STATUS.CANCELLED) {
        throw conflictNotWaiting('advance payment verification', status);
      }

      await recordSalesOrderEvent(tx, {
        salesOrderId: receipt.salesOrderId,
        action: SALES_ORDER_EVENT_ACTION.ADVANCE_RECEIPT_REJECTED,
        result: SALES_ORDER_EVENT_RESULT.REJECTED,
        fromStatus: status,
        toStatus: status,
        referenceId: receipt.id,
        remarks: data.remarks,
        actorId: actor.id,
        occurredAt: now,
      });

      return {
        message:
          'Advance receipt rejected. The Sales Order stays at its current status.',
        receipt: await tx.salesOrderAdvanceReceipt.findUnique({
          where: { id },
        }),
        salesOrder: { id: receipt.salesOrderId, status },
      };
    });
  }

  // Retracts a verification: PENDING_ACCOUNTS_APPROVAL ->
  // PENDING_STORE_APPROVAL, with a mandatory reason. The receipt goes back to
  // PENDING (undecided again) with the verifier cleared; the original
  // ADVANCE_RECEIPT_VERIFIED event is never touched, so who verified it and
  // when stays on record. Only a verification the workflow recorded (it has
  // its event, naming this receipt) can be retracted, and never once the
  // order is READY_FOR_DISPATCH_ORDER (retract the approval first) or
  // Operations/Finance have work for it. Locks go receipt first, then order,
  // the same order a verification takes, and everything is one transaction.
  async retractVerification(
    id: string,
    actorId: string | undefined,
    data: RetractSalesOrderAdvanceReceiptVerificationDto,
  ) {
    const actor = await requireActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const receipt = await tx.salesOrderAdvanceReceipt.findUnique({
        where: { id },
        select: { id: true, salesOrderId: true },
      });

      if (!receipt) {
        throw new NotFoundException('Advance receipt not found.');
      }

      const reopened = await tx.salesOrderAdvanceReceipt.updateMany({
        where: { id, verificationStatus: ADVANCE_RECEIPT_VERIFIED_STATUS },
        data: {
          verificationStatus: ADVANCE_RECEIPT_PENDING_STATUS,
          verifiedBy: null,
          verifiedAt: null,
        },
      });

      if (reopened.count === 0) {
        const current = await tx.salesOrderAdvanceReceipt.findUnique({
          where: { id },
          select: { verificationStatus: true },
        });

        if (!current) {
          throw new NotFoundException('Advance receipt not found.');
        }

        throw new ConflictException(
          `This advance receipt is not verified (${current.verificationStatus.toLowerCase().replace(/_/g, ' ')}), so there is no verification to retract.`,
        );
      }

      const status = await lockSalesOrder(tx, receipt.salesOrderId);
      const to = SALES_ORDER_STATUS.PENDING_STORE_APPROVAL;

      if (!isSalesOrderRetractionAllowed(status, to)) {
        throw conflictCannotRetract(
          'A verification',
          SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
          status,
        );
      }

      await assertLifecycleEvent(
        tx,
        receipt.salesOrderId,
        SALES_ORDER_EVENT_ACTION.ADVANCE_RECEIPT_VERIFIED,
        receipt.id,
        'verification',
      );
      await assertNoDownstreamWork(tx, receipt.salesOrderId, 'retract');

      const moved = await retractSalesOrder(
        tx,
        receipt.salesOrderId,
        SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
        to,
      );

      if (!moved) {
        const order = await requireSalesOrder(tx, receipt.salesOrderId);
        throw conflictCannotRetract(
          'A verification',
          SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
          order.status,
        );
      }

      await recordSalesOrderEvent(tx, {
        salesOrderId: receipt.salesOrderId,
        action: SALES_ORDER_EVENT_ACTION.ADVANCE_RECEIPT_VERIFICATION_RETRACTED,
        result: SALES_ORDER_EVENT_RESULT.RETRACTED,
        fromStatus: SALES_ORDER_STATUS.PENDING_ACCOUNTS_APPROVAL,
        toStatus: to,
        referenceId: receipt.id,
        remarks: data.reason,
        actorId: actor.id,
        occurredAt: now,
      });

      return {
        message:
          'Verification retracted. The advance receipt is pending again and the Sales Order is waiting for advance payment verification.',
        receipt: await tx.salesOrderAdvanceReceipt.findUnique({
          where: { id },
        }),
        salesOrder: { id: receipt.salesOrderId, status: to },
      };
    });
  }
}
