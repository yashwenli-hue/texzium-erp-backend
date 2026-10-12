import { Prisma } from '@prisma/client';

import type {
  DocumentColumn,
  DocumentParty,
  DocumentTable,
} from '../../../core/documents/document-renderer';
import {
  formatAmount,
  formatInr,
  formatPercent,
  formatQuantity,
} from '../../../core/documents/document-format';
import { safeText } from '../../../core/documents/document-text';

// Parts the sales documents (quotation, Proforma Invoice, tax invoice, payment
// receipt) share. They place stored values; the only arithmetic is adding up
// stored line amounts for a total row, in paise.

export type RegistrationLike = {
  gstin: string;
  legalName: string;
  tradeName?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  pincode: string;
  stateCode: string;
  stateName: string;
};

export type PricedLine = {
  lineNumber: number | null;
  description: string | null;
  hsnCode: string | null;
  quantity: number;
  unitRate: number;
  taxableAmount: number;
  gstRate: number | null;
  cgstAmount: number | null;
  sgstAmount: number | null;
  igstAmount: number | null;
  gstAmount: number;
  totalAmount: number;
};

export const stateLabel = (
  r: Pick<RegistrationLike, 'stateName' | 'stateCode'>,
) => `${safeText(r.stateName, 60)} (${safeText(r.stateCode, 4)})`;

// The buyer as the document addresses it: the customer's name, then the GST
// registration's legal name (when different), address and GSTIN.
export function buyerParty(
  heading: string,
  customerName: string | null,
  buyer: RegistrationLike | null,
  fallbackName: string | null = null,
): DocumentParty {
  const name = safeText(
    customerName ?? buyer?.legalName ?? fallbackName ?? 'Customer',
    200,
  );
  const lines: string[] = [];
  if (buyer) {
    if (safeText(buyer.legalName, 200) !== name)
      lines.push(safeText(buyer.legalName, 200));
    lines.push(safeText(buyer.addressLine1, 200));
    if (buyer.addressLine2) lines.push(safeText(buyer.addressLine2, 200));
    lines.push(safeText(`${buyer.city} ${buyer.pincode}`, 200));
    lines.push(`GSTIN ${safeText(buyer.gstin, 20)} · ${stateLabel(buyer)}`);
  }
  return { heading, name, lines: lines.filter(Boolean) };
}

export function taxTypeLabel(taxType: string | null | undefined): string {
  if (taxType === 'IGST') return 'IGST (inter-state)';
  if (taxType === 'CGST_SGST') return 'CGST + SGST (intra-state)';
  return '—';
}

export const LINE_COLUMNS: DocumentColumn[] = [
  { key: 'n', label: '#', width: 0.5 },
  { key: 'description', label: 'Description', width: 4.2, wrap: true },
  { key: 'hsn', label: 'HSN', width: 1.3 },
  { key: 'qty', label: 'Qty', width: 0.9, align: 'right' },
  { key: 'rate', label: 'Rate', width: 1.5, align: 'right' },
  { key: 'taxable', label: 'Taxable value', width: 1.7, align: 'right' },
  { key: 'gstRate', label: 'GST', width: 0.7, align: 'right' },
  { key: 'gst', label: 'GST amount', width: 1.5, align: 'right' },
  { key: 'total', label: 'Amount', width: 1.7, align: 'right' },
];

export function lineRows(lines: PricedLine[]): Array<Record<string, string>> {
  return lines.map((l, i) => ({
    n: String(l.lineNumber ?? i + 1),
    description: safeText(l.description ?? '—', 300),
    hsn: l.hsnCode ? safeText(l.hsnCode, 12) : '—',
    qty: formatQuantity(l.quantity),
    rate: formatAmount(l.unitRate),
    taxable: formatAmount(l.taxableAmount),
    gstRate: l.gstRate === null ? '—' : formatPercent(l.gstRate),
    gst: formatAmount(l.gstAmount),
    total: formatAmount(l.totalAmount),
  }));
}

// The tax of each line as stored: rate, CGST and SGST, or IGST.
export function taxSummaryTable(
  lines: PricedLine[],
  taxType: string | null,
): DocumentTable {
  const igst = taxType === 'IGST';
  const columns: DocumentColumn[] = [
    { key: 'n', label: 'Line', width: 0.6 },
    { key: 'hsn', label: 'HSN', width: 1.4 },
    { key: 'taxable', label: 'Taxable value', width: 1.8, align: 'right' },
    { key: 'rate', label: 'GST rate', width: 1, align: 'right' },
    ...(igst
      ? [{ key: 'igst', label: 'IGST', width: 1.6, align: 'right' as const }]
      : [
          { key: 'cgst', label: 'CGST', width: 1.6, align: 'right' as const },
          { key: 'sgst', label: 'SGST', width: 1.6, align: 'right' as const },
        ]),
    { key: 'gst', label: 'Total tax', width: 1.6, align: 'right' },
  ];
  return {
    columns,
    rows: lines.map((l, i) => ({
      n: String(l.lineNumber ?? i + 1),
      hsn: l.hsnCode ? safeText(l.hsnCode, 12) : '—',
      taxable: formatAmount(l.taxableAmount),
      rate: l.gstRate === null ? '—' : formatPercent(l.gstRate),
      igst: formatAmount(l.igstAmount ?? 0),
      cgst: formatAmount(l.cgstAmount ?? 0),
      sgst: formatAmount(l.sgstAmount ?? 0),
      gst: formatAmount(l.gstAmount),
    })),
  };
}

// The sum of a stored amount over the lines, added in paise.
export function sumLines(
  lines: PricedLine[],
  key: 'cgstAmount' | 'sgstAmount' | 'igstAmount',
): number {
  return (
    lines.reduce((acc, l) => acc + Math.round((l[key] ?? 0) * 100), 0) / 100
  );
}

// The total rows of a sales document from its stored amounts: taxable value,
// the GST split (as stored on the document, else on its lines; when neither
// holds a split, one GST row), and the total.
export function gstTotalRows(input: {
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
  gstRate: number | null;
  taxType: string | null;
  split: { cgst: number; sgst: number; igst: number } | null;
}): Array<{ label: string; value: string; strong?: boolean }> {
  const rate = input.gstRate !== null ? ` ${formatPercent(input.gstRate)}` : '';
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: 'Taxable value', value: formatInr(input.taxableAmount) },
  ];
  if (input.split && input.taxType === 'CGST_SGST') {
    rows.push({ label: 'CGST', value: formatInr(input.split.cgst) });
    rows.push({ label: 'SGST', value: formatInr(input.split.sgst) });
  } else if (input.split && input.taxType === 'IGST') {
    rows.push({ label: `IGST${rate}`, value: formatInr(input.split.igst) });
  } else {
    rows.push({ label: `GST${rate}`, value: formatInr(input.gstAmount) });
  }
  rows.push({
    label: 'Total',
    value: formatInr(input.totalAmount),
    strong: true,
  });
  return rows;
}

type Db = Pick<
  Prisma.TransactionClient,
  | 'salesOrder'
  | 'proformaInvoice'
  | 'quotation'
  | 'opportunity'
  | 'customer'
  | 'customerGSTRegistration'
>;

// Who a sales order was sold to and under which registrations: the customer
// (through the Quotation's opportunity), the buyer registration, the seller
// registration id, the tax type and place of supply. Read only; null where the
// order's chain does not say.
export async function resolveOrderParties(db: Db, salesOrderId: string) {
  const order = await db.salesOrder.findUnique({
    where: { id: salesOrderId },
    select: {
      salesOrderCode: true,
      quotationId: true,
      proformaInvoiceId: true,
      sellerGstId: true,
      buyerGstId: true,
      taxType: true,
      placeOfSupply: true,
    },
  });
  if (!order) return null;
  const proforma = order.proformaInvoiceId
    ? await db.proformaInvoice.findUnique({
        where: { id: order.proformaInvoiceId },
        select: { quotationId: true, proformaNumber: true },
      })
    : null;
  const quotationId = order.quotationId ?? proforma?.quotationId ?? null;
  const quotation = quotationId
    ? await db.quotation.findUnique({
        where: { id: quotationId },
        select: {
          quotationCode: true,
          opportunityId: true,
          sellerGstId: true,
          buyerGstId: true,
          taxType: true,
          placeOfSupply: true,
        },
      })
    : null;
  const opportunity = quotation
    ? await db.opportunity.findUnique({
        where: { id: quotation.opportunityId },
        select: { customerId: true },
      })
    : null;
  const customer = opportunity?.customerId
    ? await db.customer.findUnique({
        where: { id: opportunity.customerId },
        select: { id: true, customerName: true, customerCode: true },
      })
    : null;
  const buyerId = order.buyerGstId ?? quotation?.buyerGstId ?? null;
  const buyer = buyerId
    ? await db.customerGSTRegistration.findUnique({ where: { id: buyerId } })
    : null;
  return {
    salesOrderCode: order.salesOrderCode,
    proformaNumber: proforma?.proformaNumber ?? null,
    quotationCode: quotation?.quotationCode ?? null,
    sellerGstId: order.sellerGstId ?? quotation?.sellerGstId ?? null,
    taxType: quotation?.taxType ?? order.taxType ?? null,
    placeOfSupply: order.placeOfSupply ?? quotation?.placeOfSupply ?? null,
    customer,
    buyer:
      buyer && (!customer || buyer.customerId === customer.id) ? buyer : null,
  };
}
