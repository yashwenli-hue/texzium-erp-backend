import type { DocumentSpec } from '../../../core/documents/document-renderer';
import {
  amountInWordsInr,
  formatDocumentDate,
} from '../../../core/documents/document-format';
import { safeLines, safeText } from '../../../core/documents/document-text';
import type { DocumentIssuer } from '../../adminos/document-profile/document-identity';
import {
  LINE_COLUMNS,
  PricedLine,
  RegistrationLike,
  buyerParty,
  gstTotalRows,
  lineRows,
  stateLabel,
  taxSummaryTable,
  taxTypeLabel,
} from '../documents/revenue-document-parts';

export type InvoiceDocumentData = {
  invoice: {
    id: string;
    invoiceNumber: string | null;
    invoiceDate: Date;
    status: string;
    taxableAmount: number;
    gstAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    totalAmount: number;
    remarks: string | null;
  };
  items: PricedLine[];
  order: {
    salesOrderCode: string | null;
    proformaNumber: string | null;
    quotationCode: string | null;
    taxType: string | null;
    placeOfSupply: string | null;
  } | null;
  customer: { customerName: string; customerCode: string } | null;
  buyer: RegistrationLike | null;
  issuer: DocumentIssuer;
  generatedAt: Date;
};

// Why this invoice cannot be printed as a tax invoice, if it cannot: a tax
// invoice must carry its consecutive number, the supplier's and the
// recipient's GSTIN and address, and per line the description, HSN, quantity,
// value and tax (GST Rule 46). Invoices issued before invoice numbering and
// priced lines existed do not have them; nothing is made up for them.
export function invoiceDocumentBlockers(d: InvoiceDocumentData): string[] {
  const why: string[] = [];
  if (!d.invoice.invoiceNumber)
    why.push('it was issued before invoices were numbered');
  if (d.invoice.status !== 'POSTED') why.push('it is not posted');
  if (!d.issuer.registration) why.push('it has no seller GST registration');
  if (!d.customer || !d.buyer)
    why.push('it has no customer with a buyer GST registration');
  if (
    d.items.length === 0 ||
    d.items.some((i) => !i.hsnCode || !i.description || i.gstRate === null)
  )
    why.push('its lines do not carry a description, HSN and GST rate');
  if (d.order?.taxType !== 'IGST' && d.order?.taxType !== 'CGST_SGST')
    why.push('its tax type is not recorded');
  return why;
}

// A tax invoice. Every amount is the invoice's as stored (worked out by the
// backend when it was issued). An IRN, acknowledgement, QR code or e-way bill
// is never printed: e-invoicing and e-way bills are not connected to the GST
// systems yet, and the values stored for them are not genuine.
export function invoiceDocument(d: InvoiceDocumentData): DocumentSpec {
  const inv = d.invoice;
  const number = safeText(inv.invoiceNumber ?? '', 40);
  const meta: Array<[string, string]> = [
    ['Invoice no.', number],
    ['Invoice date', formatDocumentDate(inv.invoiceDate)],
    [
      'Place of supply',
      d.buyer
        ? stateLabel(d.buyer)
        : safeText(d.order?.placeOfSupply ?? '—', 60),
    ],
    ['Tax', taxTypeLabel(d.order?.taxType)],
    ['Reverse charge', 'No'],
  ];
  if (d.order?.salesOrderCode)
    meta.push(['Sales order', safeText(d.order.salesOrderCode, 40)]);
  if (d.order?.proformaNumber)
    meta.push(['Proforma no.', safeText(d.order.proformaNumber, 40)]);

  return {
    title: 'Tax Invoice',
    subtitle: 'Original for recipient',
    runningTitle: `Tax Invoice ${number}`,
    identity: d.issuer.identity,
    meta,
    parties: [buyerParty('Bill to', d.customer?.customerName ?? null, d.buyer)],
    table: { columns: LINE_COLUMNS, rows: lineRows(d.items) },
    totals: gstTotalRows({
      taxableAmount: inv.taxableAmount,
      gstAmount: inv.gstAmount,
      totalAmount: inv.totalAmount,
      gstRate:
        d.items.length > 0 &&
        d.items.every((i) => i.gstRate === d.items[0].gstRate)
          ? d.items[0].gstRate
          : null,
      taxType: d.order?.taxType ?? null,
      split: {
        cgst: inv.cgstAmount,
        sgst: inv.sgstAmount,
        igst: inv.igstAmount,
      },
    }),
    amountInWords: amountInWordsInr(inv.totalAmount),
    tables: [
      {
        heading: 'Tax by line',
        table: taxSummaryTable(d.items, d.order?.taxType ?? null),
      },
    ],
    sections: [
      { heading: 'Bank details', lines: d.issuer.bankLines },
      { heading: 'Remarks', lines: safeLines(inv.remarks, 5) },
      { heading: 'Terms', lines: d.issuer.terms.invoice },
    ],
    signature: {
      forName: d.issuer.legalName,
      name: d.issuer.signatory.name,
      designation: d.issuer.signatory.designation,
    },
    footerNote: 'This is a computer-generated invoice.',
    generatedAt: d.generatedAt,
  };
}
