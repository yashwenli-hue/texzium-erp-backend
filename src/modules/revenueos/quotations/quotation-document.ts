import type { DocumentSpec } from '../../../core/documents/document-renderer';
import {
  amountInWordsInr,
  formatDocumentDate,
  formatInr,
} from '../../../core/documents/document-format';
import { safeText } from '../../../core/documents/document-text';
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
import { hasConsistentTaxBreakdown } from './quotation-lifecycle';

export type QuotationDocumentData = {
  quotation: {
    id: string;
    quotationCode: string | null;
    quoteDate: Date;
    status: string;
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

const STATUS: Record<string, { subtitle: string; watermark: string | null }> = {
  DRAFT: { subtitle: 'Draft — not approved yet', watermark: 'DRAFT' },
  REVISED: { subtitle: 'Revised — not approved yet', watermark: 'DRAFT' },
  APPROVED: { subtitle: 'Approved', watermark: null },
  REJECTED: { subtitle: 'Rejected', watermark: 'REJECTED' },
};

// A quotation as a document. Every amount is the quotation's (or its lines')
// as stored.
export function quotationDocument(d: QuotationDocumentData): DocumentSpec {
  const q = d.quotation;
  const number = q.quotationCode ? safeText(q.quotationCode, 40) : null;
  const status = STATUS[q.status] ?? {
    subtitle: safeText(q.status, 40),
    watermark: null,
  };
  const consistent = hasConsistentTaxBreakdown(q);

  const notices: string[] = [];
  if (!number)
    notices.push(
      'This quotation was created before quotations were numbered; it has no quotation number.',
    );
  if (d.lines.length === 0)
    notices.push(
      'This quotation was recorded before line items were stored: its item, quantity and rate are not available. The amounts below are as recorded.',
    );
  if (!consistent)
    notices.push(
      'The tax breakdown of this quotation was not recorded; only its total is shown.',
    );

  return {
    title: 'Quotation',
    subtitle: status.subtitle,
    runningTitle: `Quotation ${number ?? ''}`.trim(),
    watermark: status.watermark,
    identity: d.issuer.identity,
    meta: [
      ['Quotation no.', number ?? 'Not numbered'],
      ['Date', formatDocumentDate(q.quoteDate)],
      [
        'Place of supply',
        d.buyer ? stateLabel(d.buyer) : safeText(q.placeOfSupply ?? '—', 60),
      ],
      ['Tax', taxTypeLabel(q.taxType)],
    ],
    parties: [
      buyerParty('Quotation for', d.customer?.customerName ?? null, d.buyer),
    ],
    notices,
    table: {
      columns: LINE_COLUMNS,
      rows: lineRows(d.lines),
      emptyText: 'Line details were not recorded for this quotation.',
    },
    totals: consistent
      ? gstTotalRows({
          taxableAmount: q.taxableAmount,
          gstAmount: q.gstAmount,
          totalAmount: q.totalAmount,
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
      : [
          {
            label: 'Total',
            value: formatInr(q.totalAmount),
            strong: true,
          },
        ],
    amountInWords: amountInWordsInr(q.totalAmount),
    sections: [{ heading: 'Terms', lines: d.issuer.terms.quotation }],
    signature: {
      forName: d.issuer.legalName,
      name: d.issuer.signatory.name,
      designation: d.issuer.signatory.designation,
    },
    footerNote: 'This is a computer-generated quotation.',
    generatedAt: d.generatedAt,
  };
}
