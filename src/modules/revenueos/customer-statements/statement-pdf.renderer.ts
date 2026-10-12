import type { CustomerStatement } from './customer-statements.service';
import {
  DocumentSpec,
  renderDocumentPdf,
} from '../../../core/documents/document-renderer';
import {
  formatAmount,
  formatDocumentDate,
  formatInr,
} from '../../../core/documents/document-format';
import { safeText } from '../../../core/documents/document-text';
import type { DocumentIssuer } from '../../adminos/document-profile/document-identity';

// The customer ledger statement as a PDF, on the shared document layout. Every
// figure is the statement's own (derived from the ledger by the statement
// service); this only places it. Dates are Indian calendar days.

export function periodLabel(s: Pick<CustomerStatement, 'period'>): string {
  const { from, to } = s.period;
  if (from && to)
    return `${formatDocumentDate(from)} to ${formatDocumentDate(to)}`;
  if (from) return `From ${formatDocumentDate(from)}`;
  if (to) return `Up to ${formatDocumentDate(to)}`;
  return 'All time';
}

export function statementNotices(s: CustomerStatement): string[] {
  const notices: string[] = [];
  if (!s.customer.isActive) notices.push('This customer is inactive.');
  if (s.coverage.postedInvoicesWithoutLedgerEntries > 0)
    notices.push(
      `${s.coverage.postedInvoicesWithoutLedgerEntries} posted invoice(s) of this customer have no ledger entry and are not in this statement.`,
    );
  if (s.coverage.unlinkedLegacyMatches > 0)
    notices.push(
      `${s.coverage.unlinkedLegacyMatches} opportunity(ies) look like this customer but are not linked to it; their invoices are not in this statement.`,
    );
  return notices;
}

export function statementDocument(
  s: CustomerStatement,
  issuer: DocumentIssuer,
): DocumentSpec {
  const customer = safeText(s.customer.customerName, 200);
  const code = safeText(s.customer.customerCode, 60);
  return {
    title: 'Customer Statement',
    subtitle: 'Ledger statement',
    runningTitle: `Customer Statement · ${customer} (${code})`,
    identity: issuer.identity,
    meta: [
      ['Customer code', code],
      ['Period', periodLabel(s)],
      ['Statement date', formatDocumentDate(new Date(s.generatedAt))],
    ],
    parties: [
      {
        heading: 'Statement for',
        name: customer,
        lines: [`Customer code ${code}`],
      },
    ],
    notices: statementNotices(s),
    table: {
      columns: [
        { key: 'date', label: 'Date', width: 1.3 },
        { key: 'invoice', label: 'Invoice', width: 1.8 },
        { key: 'remarks', label: 'Remarks', width: 3.6, wrap: true },
        { key: 'debit', label: 'Debit', width: 1.5, align: 'right' },
        { key: 'credit', label: 'Credit', width: 1.5, align: 'right' },
        { key: 'balance', label: 'Balance', width: 1.6, align: 'right' },
      ],
      rows: s.entries.map((e) => ({
        date: formatDocumentDate(e.entryDate),
        invoice: e.invoiceNumber ? safeText(e.invoiceNumber, 40) : '—',
        remarks: safeText(e.remarks, 300),
        debit: e.debit ? formatAmount(e.debit) : '',
        credit: e.credit ? formatAmount(e.credit) : '',
        balance: formatAmount(e.runningBalance),
      })),
      emptyText: 'No ledger entries in this period.',
    },
    totals: [
      { label: 'Opening balance', value: formatInr(s.openingBalance) },
      { label: 'Debits', value: formatInr(s.totalDebits) },
      { label: 'Credits', value: formatInr(s.totalCredits) },
      {
        label: 'Closing balance',
        value: formatInr(s.closingBalance),
        strong: true,
      },
    ],
    sections: [
      {
        heading: 'About this statement',
        lines: [
          'From the customer ledger, for invoices of opportunities linked to this customer. Balances are worked out from the ledger debits and credits; a positive balance is an amount due from the customer.',
        ],
      },
    ],
    footerNote: 'This is a computer-generated statement.',
    generatedAt: new Date(s.generatedAt),
  };
}

export function renderStatementPdf(
  s: CustomerStatement,
  issuer: DocumentIssuer,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  return renderDocumentPdf(statementDocument(s, issuer), options);
}
