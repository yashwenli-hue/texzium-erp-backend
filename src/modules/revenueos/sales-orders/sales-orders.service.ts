import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';

@Injectable()
export class SalesOrdersService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSalesOrderDto) {
    // ==========================================================
    // 1. Validate Approved Proforma Invoice
    // ==========================================================
    const proforma = await this.prisma.proformaInvoice.findUnique({
      where: {
        id: data.proformaInvoiceId,
      },
    });

    if (!proforma || proforma.customerStatus !== 'APPROVED') {
      throw new Error(
        'Sales Order can only be created from APPROVED Proforma Invoice',
      );
    }

    // ==========================================================
    // 2. Validate Inventory Item
    // ==========================================================
    const inventory = await this.prisma.inventoryItem.findUnique({
      where: {
        id: data.inventoryItemId,
      },
    });

    if (!inventory) {
      throw new Error('Inventory item not found');
    }

    // ==========================================================
    // 3. Validate Seller GST
    // ==========================================================
    const sellerGst =
      await this.prisma.companyGSTRegistration.findUnique({
        where: {
          id: data.sellerGstId,
        },
      });

    if (!sellerGst) {
      throw new Error('Seller GST not found');
    }

    // ==========================================================
    // 4. Validate Buyer GST
    // ==========================================================
    const buyerGst =
      await this.prisma.customerGSTRegistration.findUnique({
        where: {
          id: data.buyerGstId,
        },
      });

    if (!buyerGst) {
      throw new Error('Buyer GST not found');
    }

    // ==========================================================
    // 5. Determine Tax Type
    // ==========================================================
    let taxType = '';

    if (sellerGst.stateCode === buyerGst.stateCode) {
      taxType = 'CGST_SGST';
    } else {
      taxType = 'IGST';
    }

    // ==========================================================
    // 6. Check Stock Shortage
    // ==========================================================
    let shortageQty = 0;

    if (inventory.availableQty < data.orderQty) {
      shortageQty = data.orderQty - inventory.availableQty;
    }

    // ==========================================================
    // 7. Create Sales Order
    // ==========================================================
    const salesOrder = await this.prisma.salesOrder.create({
      data: {
        proformaInvoiceId: data.proformaInvoiceId,
        orderDate: new Date(data.orderDate),
        totalAmount: data.totalAmount,
        inventoryItemId: data.inventoryItemId,
        sellerGstId: data.sellerGstId,
        buyerGstId: data.buyerGstId,
        placeOfSupply: buyerGst.stateName,
        taxType,
        status: 'PENDING_STORE_APPROVAL',
      },
    });

    // ==========================================================
    // 8. Auto Create Purchase Requisition
    // ==========================================================
    if (shortageQty > 0) {
      await this.prisma.purchaseRequisition.create({
        data: {
          salesOrderId: salesOrder.id,
          inventoryItemId: data.inventoryItemId,
          requestedQty: shortageQty,
          remarks: 'Auto-created due to stock shortage',
        },
      });
    }

    return salesOrder;
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
  // Update Sales Order Status
  // ==========================================================
  async updateStatus(id: string, status: string) {
    return this.prisma.salesOrder.update({
      where: {
        id,
      },
      data: {
        status,
      },
    });
  }
}
