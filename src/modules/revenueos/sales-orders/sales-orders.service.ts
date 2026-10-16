import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CancelSalesOrderDto } from './dto/cancel-sales-order.dto';
import {
  SALES_ORDER_EVENT_ACTION,
  SALES_ORDER_EVENT_RESULT,
  SALES_ORDER_STATUS,
  assertNoDownstreamWork,
  cancelSalesOrderStatus,
  conflictCannotCancel,
  isSalesOrderCancellationAllowed,
  lockSalesOrder,
  recordSalesOrderEvent,
  requireActor,
  requireSalesOrder,
} from './sales-order-lifecycle';
import { QUOTATION_STATUS } from '../quotations/quotation-lifecycle';
import { requireActiveCustomerShared } from '../customer-master/customer-lifecycle';
import {
  badRequestBuyerGstNotCustomers,
  badRequestOrderGstDiffers,
  conflictRegistrationInactive,
} from '../customer-gst/customer-gst-lifecycle';
import {
  conflictExpired,
  conflictParentQuotationNotApproved,
  conflictTotalsDiffer,
  isProformaExpired,
  readQuotationStatusShared,
  totalsMatch,
} from '../proforma-invoices/proforma-lifecycle';
import {
  ALL_RECORDS,
  RecordScope,
  salesOrderWhere,
} from '../record-scope/record-scope';

// A client-sent total may differ from the Proforma's by no more than a paisa
// of floating-point noise.
const TOTAL_TOLERANCE = 0.005;

@Injectable()
export class SalesOrdersService {
  constructor(private prisma: PrismaService) {}

  // Creates a Sales Order from an APPROVED Proforma Invoice. This is the only
  // way a Sales Order is created: the Proforma must not have expired, its
  // Quotation must still be APPROVED, and their totals must agree.
  //
  // The order's total is the approved Proforma's totalAmount: the client's
  // number is never stored, and a different one is refused. No tax is
  // recalculated here. Only one Sales Order may exist per Proforma going
  // forward: the Proforma row is locked for the whole transaction, so two
  // simultaneous requests cannot both pass the duplicate check. (Existing
  // duplicates are left exactly as they are.) The order and the purchase
  // requisition for a stock shortage are written together. A CANCELLED order
  // no longer counts: it stays in history, but a replacement may be created.
  async create(data: CreateSalesOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      // ==========================================================
      // 1. Validate Approved Proforma Invoice (locked)
      // ==========================================================
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "ProformaInvoice"
        WHERE "id" = ${data.proformaInvoiceId}
        FOR UPDATE
      `;

      if (locked.length === 0) {
        throw new NotFoundException('Proforma Invoice not found.');
      }

      const proforma = await tx.proformaInvoice.findUnique({
        where: { id: data.proformaInvoiceId },
      });

      if (!proforma || proforma.customerStatus !== 'APPROVED') {
        throw new ConflictException(
          'Sales Order can only be created from APPROVED Proforma Invoice',
        );
      }

      // ==========================================================
      // 1b. The Proforma must still be valid, and so must its Quotation
      //
      // Valid through the end of its validity date. The Quotation is read
      // under a shared lock, so it cannot be revised, rejected or re-approved
      // while this order is being created, and the totals compared are the
      // ones the order is built from.
      // ==========================================================
      const now = new Date();

      if (
        proforma.validityDate &&
        isProformaExpired(proforma.validityDate, now)
      ) {
        throw conflictExpired(
          proforma.validityDate,
          'used to create a Sales Order',
        );
      }

      const quotationStatus = await readQuotationStatusShared(
        tx,
        proforma.quotationId,
      );

      if (quotationStatus !== QUOTATION_STATUS.APPROVED) {
        throw conflictParentQuotationNotApproved(quotationStatus);
      }

      const quotation = await tx.quotation.findUniqueOrThrow({
        where: { id: proforma.quotationId },
        select: {
          totalAmount: true,
          sellerGstId: true,
          buyerGstId: true,
          opportunity: { select: { customerId: true } },
        },
      });

      if (!totalsMatch(proforma.totalAmount, quotation.totalAmount)) {
        throw conflictTotalsDiffer(proforma.totalAmount, quotation.totalAmount);
      }

      // ==========================================================
      // 2. One non-cancelled Sales Order per Proforma
      // ==========================================================
      const existing = await tx.salesOrder.count({
        where: {
          proformaInvoiceId: data.proformaInvoiceId,
          status: { not: SALES_ORDER_STATUS.CANCELLED },
        },
      });

      if (existing > 0) {
        throw new ConflictException(
          'A Sales Order already exists for this Proforma Invoice.',
        );
      }

      // ==========================================================
      // 3. The total is the Proforma's, not the client's
      // ==========================================================
      if (
        data.totalAmount !== undefined &&
        Math.abs(data.totalAmount - proforma.totalAmount) >= TOTAL_TOLERANCE
      ) {
        throw new BadRequestException(
          `The total must match the approved Proforma Invoice (${proforma.totalAmount}).`,
        );
      }

      // ==========================================================
      // 4. Validate Inventory Item
      // ==========================================================
      const inventory = await tx.inventoryItem.findUnique({
        where: { id: data.inventoryItemId },
      });

      if (!inventory) {
        throw new NotFoundException('Inventory item not found');
      }

      // ==========================================================
      // 5. Validate Seller GST
      // ==========================================================
      const sellerGst = await tx.companyGSTRegistration.findUnique({
        where: { id: data.sellerGstId },
      });

      if (!sellerGst) {
        throw new NotFoundException('Seller GST not found');
      }

      // ==========================================================
      // 6. Validate Buyer GST
      // ==========================================================
      const buyerGst = await tx.customerGSTRegistration.findUnique({
        where: { id: data.buyerGstId },
      });

      if (!buyerGst) {
        throw new NotFoundException('Buyer GST not found');
      }

      // ==========================================================
      // 6b. The registrations are the Quotation's, and the customer's
      //
      // An order is made with the GST registrations its Quotation was made
      // with (when it has them: older quotations have none, and their orders
      // are unchanged). When the Quotation's opportunity has a customer, that
      // customer must still be active (and stays so until this commits), and
      // the buyer registration must be one of its own and active. An
      // opportunity without a customer is a legacy one and is not checked.
      // ==========================================================
      if (quotation.sellerGstId && data.sellerGstId !== quotation.sellerGstId) {
        throw badRequestOrderGstDiffers('seller');
      }

      if (quotation.buyerGstId && data.buyerGstId !== quotation.buyerGstId) {
        throw badRequestOrderGstDiffers('buyer');
      }

      const customerId = quotation.opportunity?.customerId;

      if (customerId) {
        await requireActiveCustomerShared(
          tx,
          customerId,
          'This customer is inactive. Reactivate it before creating a Sales Order for it.',
        );

        if (buyerGst.customerId !== customerId) {
          throw badRequestBuyerGstNotCustomers();
        }

        if (!buyerGst.isActive) {
          throw conflictRegistrationInactive('buyer');
        }
      }

      // ==========================================================
      // 7. Determine Tax Type
      // ==========================================================
      const taxType =
        sellerGst.stateCode === buyerGst.stateCode ? 'CGST_SGST' : 'IGST';

      // ==========================================================
      // 8. Check Stock Shortage
      // ==========================================================
      let shortageQty = 0;

      if (inventory.availableQty < data.orderQty) {
        shortageQty = data.orderQty - inventory.availableQty;
      }

      // ==========================================================
      // 9. Create Sales Order
      // ==========================================================
      const salesOrder = await tx.salesOrder.create({
        data: {
          proformaInvoiceId: data.proformaInvoiceId,
          orderDate: new Date(data.orderDate),
          totalAmount: proforma.totalAmount,
          inventoryItemId: data.inventoryItemId,
          sellerGstId: data.sellerGstId,
          buyerGstId: data.buyerGstId,
          placeOfSupply: buyerGst.stateName,
          taxType,
          status: SALES_ORDER_STATUS.PENDING_STORE_APPROVAL,
        },
      });

      // ==========================================================
      // 10. Auto Create Purchase Requisition
      // ==========================================================
      if (shortageQty > 0) {
        await tx.purchaseRequisition.create({
          data: {
            salesOrderId: salesOrder.id,
            inventoryItemId: data.inventoryItemId,
            requestedQty: shortageQty,
            remarks: 'Auto-created due to stock shortage',
          },
        });
      }

      return salesOrder;
    });
  }

  // ==========================================================
  // Cancel a Sales Order for good
  //
  // PENDING_STORE_APPROVAL, PENDING_ACCOUNTS_APPROVAL or
  // READY_FOR_DISPATCH_ORDER -> CANCELLED, with a mandatory reason. Nothing
  // else about the order is touched: a VERIFIED advance receipt stays VERIFIED
  // (the advance is not refunded here), payment terms and approvals stay as
  // they are, and the Proforma and Quotation keep their status. The order row
  // is locked for the whole transaction, so the downstream checks and the
  // status change are one decision: Operations cannot slip a dispatch order or
  // an invoice in between, and a racing verification or approval either goes
  // first (and this sees the new status) or loses with a 409.
  // ==========================================================
  async cancel(
    id: string,
    actorId: string | undefined,
    data: CancelSalesOrderDto,
  ) {
    const actor = await requireActor(this.prisma, actorId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      const from = await lockSalesOrder(tx, id);

      if (!isSalesOrderCancellationAllowed(from)) {
        throw conflictCannotCancel(from);
      }

      await assertNoDownstreamWork(tx, id, 'cancel');

      const moved = await cancelSalesOrderStatus(tx, id, from);

      if (!moved) {
        const order = await requireSalesOrder(tx, id);
        throw conflictCannotCancel(order.status);
      }

      await recordSalesOrderEvent(tx, {
        salesOrderId: id,
        action: SALES_ORDER_EVENT_ACTION.SALES_ORDER_CANCELLED,
        result: SALES_ORDER_EVENT_RESULT.CANCELLED,
        fromStatus: from,
        toStatus: SALES_ORDER_STATUS.CANCELLED,
        remarks: data.reason,
        actorId: actor.id,
        occurredAt: now,
      });

      return {
        message: 'Sales Order cancelled.',
        salesOrder: { id, status: SALES_ORDER_STATUS.CANCELLED },
      };
    });
  }

  // ==========================================================
  // Get All Sales Orders
  // ==========================================================
  async findAll(scope: RecordScope = ALL_RECORDS) {
    return this.prisma.salesOrder.findMany({
      where: salesOrderWhere(scope),
      include: {
        proformaInvoice: true,
      },
    });
  }

  // ==========================================================
  // Lifecycle history of one Sales Order, newest first
  // ==========================================================
  async findEvents(id: string) {
    await requireSalesOrder(this.prisma, id);

    return this.prisma.salesOrderEvent.findMany({
      where: { salesOrderId: id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        // Only id and name leave the API as an actor.
        actor: { select: { id: true, fullName: true } },
      },
    });
  }
}
