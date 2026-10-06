import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SALES_ORDER_STATUS, requireSalesOrder } from './sales-order-lifecycle';

// A client-sent total may differ from the Proforma's by no more than a paisa
// of floating-point noise.
const TOTAL_TOLERANCE = 0.005;

@Injectable()
export class SalesOrdersService {
  constructor(private prisma: PrismaService) {}

  // Creates a Sales Order from an APPROVED Proforma Invoice.
  //
  // The order's total is the approved Proforma's totalAmount: the client's
  // number is never stored, and a different one is refused. No tax is
  // recalculated here. Only one Sales Order may exist per Proforma going
  // forward: the Proforma row is locked for the whole transaction, so two
  // simultaneous requests cannot both pass the duplicate check. (Existing
  // duplicates are left exactly as they are.) The order and the purchase
  // requisition for a stock shortage are written together.
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
      // 2. One Sales Order per Proforma
      // ==========================================================
      const existing = await tx.salesOrder.count({
        where: { proformaInvoiceId: data.proformaInvoiceId },
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
  // Get All Sales Orders
  // ==========================================================
  async findAll() {
    return this.prisma.salesOrder.findMany({
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
