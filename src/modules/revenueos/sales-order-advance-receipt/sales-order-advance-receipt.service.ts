import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderAdvanceReceiptDto } from './dto/create-sales-order-advance-receipt.dto';
import { VerifySalesOrderAdvanceReceiptDto } from './dto/verify-sales-order-advance-receipt.dto';
import {
  SALES_ORDER_EVENT_ACTION,
  SALES_ORDER_EVENT_RESULT,
  SALES_ORDER_NOT_FOUND_MESSAGE,
  SALES_ORDER_STATUS,
  advanceSalesOrder,
  conflictNotWaiting,
  readSalesOrderStatusShared,
  recordSalesOrderEvent,
  requireActor,
  requireSalesOrder,
} from '../sales-orders/sales-order-lifecycle';

@Injectable()
export class SalesOrderAdvanceReceiptService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesOrderAdvanceReceiptDto) {
    const salesOrder = await this.prisma.salesOrder.findUnique({
      where: { id: data.salesOrderId },
      select: { id: true },
    });

    if (!salesOrder) {
      throw new NotFoundException(SALES_ORDER_NOT_FOUND_MESSAGE);
    }

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

      // REJECTED: the order does not move.
      const status = await readSalesOrderStatusShared(tx, receipt.salesOrderId);

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
}
