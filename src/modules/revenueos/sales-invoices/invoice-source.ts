import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { QUOTATION_AMOUNT_TOLERANCE } from '../quotations/quotation-values';
import {
  hasConsistentTaxBreakdown,
  roundMoney,
} from '../quotations/quotation-lifecycle';
import { isKnownTaxType, splitGst } from '../tax/gst-split';
import { SALES_ORDER_NOT_FOUND_MESSAGE } from '../sales-orders/sales-order-lifecycle';

type Tx = Prisma.TransactionClient;

// What an invoice is made from: its Sales Order, the Quotation the order was
// built from (directly, or through its Proforma Invoice), the priced lines (the
// Proforma's copy, else the Quotation's), the seller and buyer GST registrations
// and the customer. Read inside the invoicing transaction, after the order is
// locked.
export type InvoiceSource = {
  order: {
    id: string;
    totalAmount: number;
    quotationId: string | null;
    proformaInvoiceId: string | null;
    sellerGstId: string | null;
    buyerGstId: string | null;
  };
  quotation: {
    id: string;
    taxableAmount: number;
    gstPercent: number;
    gstAmount: number;
    totalAmount: number;
    taxType: string | null;
    sellerGstId: string | null;
    buyerGstId: string | null;
    opportunityId: string;
  } | null;
  lines: Array<{
    id: string;
    lineNumber: number;
    inventoryItemId: string | null;
    description: string;
    hsnCode: string | null;
    quantity: number;
    unitRate: number;
    taxableAmount: number;
    gstRate: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    gstAmount: number;
    totalAmount: number;
  }>;
  seller: { id: string; stateCode: string; isActive: boolean } | null;
  buyer: { id: string; customerId: string } | null;
  customer: { id: string; customerName: string } | null;
};

const LINES_ORDER = { lineNumber: 'asc' } as const;

export async function loadInvoiceSource(
  tx: Tx,
  salesOrderId: string,
): Promise<InvoiceSource> {
  const order = await tx.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      id: true,
      totalAmount: true,
      quotationId: true,
      proformaInvoiceId: true,
      sellerGstId: true,
      buyerGstId: true,
    },
  });
  if (!order) throw new NotFoundException(SALES_ORDER_NOT_FOUND_MESSAGE);

  const proforma = order.proformaInvoiceId
    ? await tx.proformaInvoice.findUnique({
        where: { id: order.proformaInvoiceId },
        select: { id: true, quotationId: true },
      })
    : null;

  const quotationId = order.quotationId ?? proforma?.quotationId ?? null;
  const quotation = quotationId
    ? await tx.quotation.findUnique({
        where: { id: quotationId },
        select: {
          id: true,
          taxableAmount: true,
          gstPercent: true,
          gstAmount: true,
          totalAmount: true,
          taxType: true,
          sellerGstId: true,
          buyerGstId: true,
          opportunityId: true,
        },
      })
    : null;

  let lines: InvoiceSource['lines'] = proforma
    ? await tx.proformaInvoiceLine.findMany({
        where: { proformaInvoiceId: proforma.id },
        orderBy: LINES_ORDER,
      })
    : [];
  if (lines.length === 0 && quotation) {
    lines = await tx.quotationLine.findMany({
      where: { quotationId: quotation.id },
      orderBy: LINES_ORDER,
    });
  }

  const sellerId = order.sellerGstId ?? quotation?.sellerGstId ?? null;
  const buyerId = order.buyerGstId ?? quotation?.buyerGstId ?? null;
  const seller = sellerId
    ? await tx.companyGSTRegistration.findUnique({
        where: { id: sellerId },
        select: { id: true, stateCode: true, isActive: true },
      })
    : null;
  const buyer = buyerId
    ? await tx.customerGSTRegistration.findUnique({
        where: { id: buyerId },
        select: { id: true, customerId: true },
      })
    : null;

  const opportunity = quotation
    ? await tx.opportunity.findUnique({
        where: { id: quotation.opportunityId },
        select: { customerId: true },
      })
    : null;
  const customer = opportunity?.customerId
    ? await tx.customer.findUnique({
        where: { id: opportunity.customerId },
        select: { id: true, customerName: true },
      })
    : null;

  return { order, quotation, lines, seller, buyer, customer };
}

// The invoice an order gets, or why it cannot be invoiced. Every amount comes
// from the Quotation the order was built from (the order's total must be that
// Quotation's): nothing is added on top and no rate is assumed. The GST split is
// the lines' stored split, or, for a Quotation without lines, its GST split by
// its tax type.
export type InvoicePlan = {
  taxableAmount: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  taxType: string;
  seller: { id: string; stateCode: string };
  customer: { id: string; customerName: string };
  lines: InvoiceSource['lines'];
};

const refuse = (message: string) =>
  new ConflictException(`${message} No invoice was created.`);

export function planInvoice(source: InvoiceSource): InvoicePlan {
  const { order, quotation, lines, seller, buyer, customer } = source;

  if (!quotation) {
    throw refuse(
      'This Sales Order was not created from a Quotation, so its tax cannot be determined.',
    );
  }
  if (
    !hasConsistentTaxBreakdown(quotation) ||
    !isKnownTaxType(quotation.taxType)
  ) {
    throw refuse(
      "The Quotation behind this Sales Order has no complete tax breakdown (taxable amount, GST rate, GST and tax type), so the invoice's tax cannot be determined.",
    );
  }
  if (
    Math.abs(order.totalAmount - quotation.totalAmount) >
    QUOTATION_AMOUNT_TOLERANCE
  ) {
    throw refuse(
      `This Sales Order's total (${order.totalAmount}) is not its Quotation's total including GST (${quotation.totalAmount}), so the invoice amounts cannot be confirmed.`,
    );
  }
  if (!seller) {
    throw refuse('This Sales Order has no seller GST registration.');
  }
  if (!seller.isActive) {
    throw refuse(
      'The seller GST registration of this Sales Order is inactive.',
    );
  }
  if (!customer) {
    throw refuse(
      "This Sales Order's opportunity is not linked to a customer, so the invoice has no recipient.",
    );
  }
  if (!buyer || buyer.customerId !== customer.id) {
    throw refuse(
      'This Sales Order has no buyer GST registration of its customer.',
    );
  }

  let split = splitGst(quotation.gstAmount, quotation.taxType);
  if (lines.length > 0) {
    const sum = (
      k:
        | 'taxableAmount'
        | 'gstAmount'
        | 'totalAmount'
        | 'cgstAmount'
        | 'sgstAmount'
        | 'igstAmount',
    ) => roundMoney(lines.reduce((acc, l) => acc + l[k], 0));
    const near = (a: number, b: number) =>
      Math.abs(a - b) <= QUOTATION_AMOUNT_TOLERANCE;
    if (
      !near(sum('taxableAmount'), quotation.taxableAmount) ||
      !near(sum('gstAmount'), quotation.gstAmount) ||
      !near(sum('totalAmount'), quotation.totalAmount) ||
      lines.some((l) => !l.inventoryItemId)
    ) {
      throw refuse(
        "The priced lines of this Sales Order's Quotation do not add up to its amounts.",
      );
    }
    split = {
      cgstAmount: sum('cgstAmount'),
      sgstAmount: sum('sgstAmount'),
      igstAmount: sum('igstAmount'),
    };
  }

  return {
    taxableAmount: quotation.taxableAmount,
    gstAmount: quotation.gstAmount,
    totalAmount: quotation.totalAmount,
    ...split,
    taxType: quotation.taxType,
    seller: { id: seller.id, stateCode: seller.stateCode },
    customer,
    lines,
  };
}
