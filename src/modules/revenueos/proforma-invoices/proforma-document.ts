import type { DocumentSpec } from '../../../core/documents/document-renderer';
import {
  amountInWordsInr,
  formatDocumentDate,
  formatInr,
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
  sumLines,
  taxTypeLabel,
} from '../documents/revenue-document-parts';
import { hasConsistentTaxBreakdown } from '../quotations/quotation-lifecycle';

export type ProformaDocumentData = {
  proforma: {
    id: string;
    proformaNumber: string | null;
    issueDate: Date;
    validityDate: Date | null;
    customerStatus: string;
    totalAmount: number;
    remarks: string | null;
    isExpired: boolean;
  };
  quotation: {
    quotationCode: string | null;
    taxType: string | null;
    placeOfSupply: string | null;
    taxableAmount: number;
    gstPercent: number;
    gstAmount: number;
    totalAmount: number;
  };
  lines: PricedLine[];
  customer: { customerName: string; customerCode: string } | null;
  buyer: RegistrationLike | null;
  issuer: DocumentIssuer;
  generatedAt: Date;
};

// A Proforma Invoice as a document: clearly not a tax invoice. Its total is its
// own (it was checked against its Quotation's when it was created); the taxable
// value and GST are its Quotation's; the lines are the copy it took.
export function proformaDocument(d: ProformaDocumentData): DocumentSpec {
  const p = d.proforma;
  const q = d.quotation;
  const number = p.proformaNumber ? safeText(p.proformaNumber, 40) : null;
  const cancelled = p.customerStatus === 'CANCELLED';
  const consistent = hasConsistentTaxBreakdown(q);

  const notices: string[] = [
    'This is a Proforma Invoice: a request for payment before supply. It is not a tax invoice and does not by itself make GST payable.',
  ];
  if (!number)
    notices.push(
      'This Proforma Invoice was created before Proforma Invoices were numbered; it has no number.',
    );
  if (cancelled) notices.push('This Proforma Invoice has been cancelled.');
  else if (p.isExpired)
    notices.push('The validity date of this Proforma Invoice has passed.');
  if (d.lines.length === 0)
    notices.push(
      'Line details were not recorded for the quotation this Proforma Invoice was made from. The amounts below are as recorded.',
    );

  const meta: Array<[string, string]> = [
    ['Proforma no.', number ?? 'Not numbered'],
    ['Issue date', formatDocumentDate(p.issueDate)],
  ];
  if (p.validityDate)
    meta.push(['Valid until', formatDocumentDate(p.validityDate)]);
  if (q.quotationCode)
    meta.push(['Quotation no.', safeText(q.quotationCode, 40)]);
  meta.push([
    'Place of supply',
    d.buyer ? stateLabel(d.buyer) : safeText(q.placeOfSupply ?? '—', 60),
  ]);
  meta.push(['Tax', taxTypeLabel(q.taxType)]);

  return {
    title: 'Proforma Invoice',
    subtitle: 'Not a tax invoice',
    runningTitle: `Proforma Invoice ${number ?? ''}`.trim(),
    watermark: cancelled ? 'CANCELLED' : null,
    identity: d.issuer.identity,
    meta,
    parties: [buyerParty('Bill to', d.customer?.customerName ?? null, d.buyer)],
    notices,
    table: {
      columns: LINE_COLUMNS,
      rows: lineRows(d.lines),
      emptyText: 'Line details were not recorded.',
    },
    totals: consistent
      ? gstTotalRows({
          taxableAmount: q.taxableAmount,
          gstAmount: q.gstAmount,
          totalAmount: p.totalAmount,
          gstRate: q.gstPercent,
          taxType: q.taxType,
          split:
            d.lines.length > 0
              ? {
                  cgst: sumLines(d.lines, 'cgstAmount'),
                  sgst: sumLines(d.lines, 'sgstAmount'),
                  igst: sumLines(d.lines, 'igstAmount'),
                }
              : null,
        })
      : [{ label: 'Total', value: formatInr(p.totalAmount), strong: true }],
    amountInWords: amountInWordsInr(p.totalAmount),
    sections: [
      { heading: 'Bank details', lines: d.issuer.bankLines },
      { heading: 'Remarks', lines: safeLines(p.remarks, 5) },
      { heading: 'Terms', lines: d.issuer.terms.proforma },
    ],
    signature: {
      forName: d.issuer.legalName,
      name: d.issuer.signatory.name,
      designation: d.issuer.signatory.designation,
    },
    footerNote: 'This is a computer-generated Proforma Invoice.',
    generatedAt: d.generatedAt,
  };
}
