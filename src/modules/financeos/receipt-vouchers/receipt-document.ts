import type { DocumentSpec } from '../../../core/documents/document-renderer';
import {
  amountInWordsInr,
  formatAmount,
  formatDocumentDate,
  formatInr,
} from '../../../core/documents/document-format';
import { safeText } from '../../../core/documents/document-text';
import type { DocumentIssuer } from '../../adminos/document-profile/document-identity';
import {
  RegistrationLike,
  buyerParty,
} from '../../revenueos/documents/revenue-document-parts';

export type ReceiptDocumentData = {
  receipt: {
    id: string;
    receiptNumber: string | null;
    receiptDate: Date;
    amountReceived: number;
    paymentMode: string;
    referenceNo: string | null;
  };
  invoice: {
    invoiceNumber: string | null;
    invoiceDate: Date;
    totalAmount: number;
    customerName: string | null;
  } | null;
  // what the payment did to the invoice's receivable, as recorded with it
  event: { balanceBefore: number; balanceAfter: number } | null;
  customer: { customerName: string; customerCode: string } | null;
  buyer: RegistrationLike | null;
  issuer: DocumentIssuer;
  generatedAt: Date;
};

const MODES: Record<string, string> = {
  BANK_TRANSFER: 'Bank transfer',
  NEFT: 'NEFT',
  RTGS: 'RTGS',
  IMPS: 'IMPS',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  CASH: 'Cash',
  CARD: 'Card',
};

// A payment receipt: the payment as recorded, the invoice it was taken against
// and the receivable balance before and after it, as recorded when the payment
// was taken. Payments recorded before balances were kept show no balances.
export function receiptDocument(d: ReceiptDocumentData): DocumentSpec {
  const r = d.receipt;
  const number = safeText(r.receiptNumber ?? '', 40) || 'Not numbered';
  const notices: string[] = [];
  if (!d.event)
    notices.push(
      'The balance of the invoice before and after this payment was not recorded (payments taken before balances were kept).',
    );
  if (!d.invoice)
    notices.push(
      'The invoice this payment was taken against could not be found.',
    );

  const meta: Array<[string, string]> = [
    ['Receipt no.', number],
    ['Receipt date', formatDocumentDate(r.receiptDate)],
    ['Payment mode', MODES[r.paymentMode] ?? safeText(r.paymentMode, 40)],
  ];
  if (r.referenceNo) meta.push(['Reference', safeText(r.referenceNo, 60)]);

  return {
    title: 'Payment Receipt',
    subtitle: 'Payment received against invoice',
    runningTitle: `Payment Receipt ${number}`,
    identity: d.issuer.identity,
    meta,
    parties: [
      buyerParty(
        'Received from',
        d.customer?.customerName ?? null,
        d.buyer,
        d.invoice?.customerName ?? null,
      ),
    ],
    notices,
    table: {
      columns: [
        { key: 'invoice', label: 'Invoice', width: 2 },
        { key: 'date', label: 'Invoice date', width: 1.5 },
        { key: 'total', label: 'Invoice total', width: 1.7, align: 'right' },
        { key: 'before', label: 'Balance before', width: 1.7, align: 'right' },
        { key: 'paid', label: 'Received', width: 1.7, align: 'right' },
        { key: 'after', label: 'Balance after', width: 1.7, align: 'right' },
      ],
      rows: d.invoice
        ? [
            {
              invoice: d.invoice.invoiceNumber
                ? safeText(d.invoice.invoiceNumber, 40)
                : 'Not numbered',
              date: formatDocumentDate(d.invoice.invoiceDate),
              total: formatAmount(d.invoice.totalAmount),
              before: d.event ? formatAmount(d.event.balanceBefore) : '—',
              paid: formatAmount(r.amountReceived),
              after: d.event ? formatAmount(d.event.balanceAfter) : '—',
            },
          ]
        : [],
      emptyText: 'No invoice.',
    },
    totals: [
      {
        label: 'Amount received',
        value: formatInr(r.amountReceived),
        strong: true,
      },
    ],
    amountInWords: amountInWordsInr(r.amountReceived),
    sections: [{ heading: 'Note', lines: d.issuer.terms.receipt }],
    signature: {
      forName: d.issuer.legalName,
      name: d.issuer.signatory.name,
      designation: d.issuer.signatory.designation,
    },
    footerNote:
      'This receipt acknowledges a payment against an invoice; it is not a GST receipt voucher for an advance.',
    generatedAt: d.generatedAt,
  };
}
