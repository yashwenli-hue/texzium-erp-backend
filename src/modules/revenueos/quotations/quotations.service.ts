import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';

@Injectable()
export class QuotationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateQuotationDto) {
    // 1. Validate Opportunity
    const opportunity = await this.prisma.opportunity.findUnique({
      where: { id: data.opportunityId },
    });

    if (!opportunity) {
      throw new Error('Opportunity not found');
    }

    // 2. Validate Inventory Item
    const inventory = await this.prisma.inventoryItem.findUnique({
      where: { id: data.inventoryItemId },
      include: {
        hsnMaster: true,
      },
    });

    if (!inventory) {
      throw new Error('Inventory item not found');
    }

    if (!inventory.hsnMaster) {
      throw new Error('HSN not mapped to inventory item');
    }

    // 3. Validate Seller GST
    const sellerGst =
      await this.prisma.companyGSTRegistration.findUnique({
        where: { id: data.sellerGstId },
      });

    if (!sellerGst) {
      throw new Error('Seller GST not found');
    }

    // 4. Validate Buyer GST
    const buyerGst =
      await this.prisma.customerGSTRegistration.findUnique({
        where: { id: data.buyerGstId },
      });

    if (!buyerGst) {
      throw new Error('Buyer GST not found');
    }

    // 5. Tax Type Logic
    let taxType = '';
    let gstAmount = 0;

    const taxableAmount = data.quantity * data.unitPrice;

    if (sellerGst.stateCode === buyerGst.stateCode) {
      taxType = 'CGST_SGST';
      gstAmount =
        (taxableAmount * inventory.hsnMaster.gstRate) / 100;
    } else {
      taxType = 'IGST';
      gstAmount =
        (taxableAmount * inventory.hsnMaster.gstRate) / 100;
    }

    const totalAmount = taxableAmount + gstAmount;

    // 6. Create Quotation
    return this.prisma.quotation.create({
      data: {
        opportunityId: data.opportunityId,
        quoteDate: new Date(data.quoteDate),

        sellerGstId: data.sellerGstId,
        buyerGstId: data.buyerGstId,
        placeOfSupply: buyerGst.stateName,
        taxType: taxType,

        taxableAmount: taxableAmount,
        gstPercent: inventory.hsnMaster.gstRate,
        gstAmount: gstAmount,
        totalAmount: totalAmount,

        status: 'DRAFT',
      },
    });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: { status },
    });
  }

  async findAll() {
    return this.prisma.quotation.findMany({
      include: {
        opportunity: true,
      },
    });
  }

  async reviseQuotation(
    id: string,
    totalAmount: number,
  ) {
    return this.prisma.quotation.update({
      where: { id },
      data: {
        totalAmount,
        status: 'REVISED',
      },
    });
  }

  async approveQuotation(id: string) {
    return this.prisma.quotation.update({
      where: { id },
      data: {
        status: 'APPROVED',
      },
    });
  }

  async convertToSalesOrder(id: string) {
    const quotation =
      await this.prisma.quotation.findUnique({
        where: { id },
      });

    if (!quotation) {
      throw new Error('Quotation not found');
    }

    return this.prisma.salesOrder.create({
      data: {
        quotationId: quotation.id,
        orderDate: new Date(),
        totalAmount: quotation.totalAmount,
        sellerGstId: quotation.sellerGstId,
        buyerGstId: quotation.buyerGstId,
        placeOfSupply: quotation.placeOfSupply,
        taxType: quotation.taxType,
        status: 'OPEN',
      },
    });
  }
}
