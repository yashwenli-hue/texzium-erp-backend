import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/database/prisma.service';

@Injectable()
export class SalesReportsService {
  constructor(private prisma: PrismaService) {}

  async funnel() {
    const leads =
      await this.prisma.lead.count({
        where: { isActive: true },
      });

    const opportunities =
      await this.prisma.opportunity.count();

    const quotations =
      await this.prisma.quotation.count();

    // A cancelled Sales Order is no longer part of the pipeline: it is left
    // out of salesOrders and reported on its own.
    const salesOrders =
      await this.prisma.salesOrder.count({
        where: { status: { not: 'CANCELLED' } },
      });

    const cancelledSalesOrders =
      await this.prisma.salesOrder.count({
        where: { status: 'CANCELLED' },
      });

    const invoices =
      await this.prisma.salesInvoice.count();

    return {
      leads,
      opportunities,
      quotations,
      salesOrders,
      cancelledSalesOrders,
      invoices,
    };
  }

  async revenueSummary() {
    const invoices =
      await this.prisma.salesInvoice.findMany();

    const totalRevenue =
      invoices.reduce(
        (sum, item) => sum + item.totalAmount,
        0,
      );

    const totalTax =
      invoices.reduce(
        (sum, item) => sum + item.gstAmount,
        0,
      );

    const taxableRevenue =
      invoices.reduce(
        (sum, item) => sum + item.taxableAmount,
        0,
      );

    return {
      totalRevenue,
      taxableRevenue,
      totalTax,
    };
  }

  async customerRevenue() {
    return this.prisma.salesInvoice.groupBy({
      by: ['customerName'],
      _sum: {
        totalAmount: true,
      },
      orderBy: {
        _sum: {
          totalAmount: 'desc',
        },
      },
    });
  }
  
  async leadConversion() {
  const leads =
    await this.prisma.lead.count({
      where: { isActive: true },
    });

  const opportunities =
    await this.prisma.opportunity.count();

  const conversionRate =
    leads > 0
      ? (opportunities / leads) * 100
      : 0;

  return {
    totalLeads: leads,
    convertedToOpportunity: opportunities,
    conversionRate: conversionRate.toFixed(2) + '%',
  };
}

async quotationConversion() {
  const quotations =
    await this.prisma.quotation.count();

  // Cancelled Sales Orders are not conversions; they are reported separately.
  const salesOrders =
    await this.prisma.salesOrder.count({
      where: { status: { not: 'CANCELLED' } },
    });

  const cancelledSalesOrders =
    await this.prisma.salesOrder.count({
      where: { status: 'CANCELLED' },
    });

  const conversionRate =
    quotations > 0
      ? (salesOrders / quotations) * 100
      : 0;

  return {
    totalQuotations: quotations,
    convertedToSalesOrders: salesOrders,
    cancelledSalesOrders,
    conversionRate: conversionRate.toFixed(2) + '%',
  };
}

async lostOpportunities() {
  return this.prisma.opportunity.findMany({
    where: {
      status: 'LOST',
    },
  });
}

async salespersonPerformance() {
  return this.prisma.salesInvoice.groupBy({
    by: ['customerName'],
    _sum: {
      totalAmount: true,
    },
    orderBy: {
      _sum: {
        totalAmount: 'desc',
      },
    },
  });
}

async topProducts() {
  return this.prisma.salesInvoiceItem.groupBy({
    by: ['productId'],
    _sum: {
      totalAmount: true,
    },
    orderBy: {
      _sum: {
        totalAmount: 'desc',
      },
    },
  });
}

async productRevenue() {
  return this.prisma.salesInvoiceItem.groupBy({
    by: ['productId'],
    _sum: {
      taxableAmount: true,
      gstAmount: true,
      totalAmount: true,
    },
    orderBy: {
      _sum: {
        totalAmount: 'desc',
      },
    },
  });
}

async productQuantity() {
  return this.prisma.salesInvoiceItem.groupBy({
    by: ['productId'],
    _sum: {
      quantity: true,
    },
    orderBy: {
      _sum: {
        quantity: 'desc',
      },
    },
  });
}

async hsnRevenue() {
  const items =
    await this.prisma.salesInvoiceItem.findMany({
      include: {
        salesInvoice: true,
      },
    });

  const inventory =
    await this.prisma.inventoryItem.findMany({
      include: {
        hsnMaster: true,
      },
    });

  const result = {};

  for (const item of items) {
    const product = inventory.find(
      (x) => x.sku === item.productId,
    );

    if (!product?.hsnMaster?.hsnCode) continue;

    const hsn = product.hsnMaster.hsnCode;

    if (!result[hsn]) {
      result[hsn] = {
        taxableAmount: 0,
        gstAmount: 0,
        totalAmount: 0,
      };
    }

    result[hsn].taxableAmount += item.taxableAmount;
    result[hsn].gstAmount += item.gstAmount;
    result[hsn].totalAmount += item.totalAmount;
  }

  return result;
}

async categoryRevenue() {
  const items =
    await this.prisma.salesInvoiceItem.findMany();

  const inventory =
    await this.prisma.inventoryItem.findMany();

  const result = {};

  for (const item of items) {
    const product = inventory.find(
      (x) => x.sku === item.productId,
    );

    if (!product?.category) continue;

    const category = product.category;

    if (!result[category]) {
      result[category] = {
        taxableAmount: 0,
        gstAmount: 0,
        totalAmount: 0,
      };
    }

    result[category].taxableAmount += item.taxableAmount;
    result[category].gstAmount += item.gstAmount;
    result[category].totalAmount += item.totalAmount;
  }

  return result;
}

}
