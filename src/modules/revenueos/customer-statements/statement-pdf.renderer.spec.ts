import type { CustomerStatement } from './customer-statements.service';
import {
  formatDay,
  formatInr,
  pdfText,
  periodLabel,
  renderStatementPdf,
  statementHeaderLines,
} from './statement-pdf.renderer';

const statement = (
  over: Partial<CustomerStatement> = {},
): CustomerStatement => ({
  customer: {
    id: 'c',
    customerCode: 'CUST-A',
    customerName: 'Raj Traders',
    isActive: true,
  },
  period: { from: '2026-04-15', to: '2026-05-01' },
  currency: 'INR',
  openingBalance: 1000,
  totalDebits: 250.55,
  totalCredits: 450,
  closingBalance: 800.55,
  entries: [
    {
      id: 'l2',
      entryDate: '2026-04-15',
      salesInvoiceId: 'i',
      invoiceNumber: 'INV-A1',
      debit: 0,
      credit: 400,
      runningBalance: 600,
      remarks: 'Payment received UTR1',
    },
  ],
  coverage: { postedInvoicesWithoutLedgerEntries: 0, unlinkedLegacyMatches: 0 },
  generatedAt: '2026-10-11T09:30:00.000Z',
  ...over,
});

describe('statement PDF', () => {
  it('formats amounts as INR with Indian digit grouping', () => {
    expect(formatInr(0)).toBe('INR 0.00');
    expect(formatInr(999.5)).toBe('INR 999.50');
    expect(formatInr(1234567.8)).toBe('INR 12,34,567.80');
    expect(formatInr(100000)).toBe('INR 1,00,000.00');
    expect(formatInr(-50)).toBe('INR -50.00');
    expect(formatInr(-0.001)).toBe('INR 0.00');
  });

  it('formats calendar days without any time zone shift', () => {
    expect(formatDay('2026-04-01')).toBe('01 Apr 2026');
    expect(formatDay('2024-12-31')).toBe('31 Dec 2024');
  });

  it('labels the period', () => {
    expect(periodLabel(statement())).toBe('15 Apr 2026 to 01 May 2026');
    expect(periodLabel(statement({ period: { from: null, to: null } }))).toBe(
      'All time',
    );
    expect(
      periodLabel(statement({ period: { from: '2026-04-15', to: null } })),
    ).toBe('From 15 Apr 2026');
    expect(
      periodLabel(statement({ period: { from: null, to: '2026-05-01' } })),
    ).toBe('Up to 01 May 2026');
  });

  it('keeps names and remarks to plain, bounded Latin-1 text', () => {
    expect(pdfText('Raj\u0000 Traders\r\n(Pune)')).toBe('Raj Traders (Pune)');
    expect(pdfText('राज Traders')).toBe('??? Traders');
    expect(pdfText('Café')).toBe('Café');
    expect(pdfText('x'.repeat(300), 20)).toBe(`${'x'.repeat(17)}...`);
    expect(pdfText(null)).toBe('');
  });

  it('heads the statement with the customer, period, figures and its basis', () => {
    expect(statementHeaderLines(statement())).toEqual([
      'Customer statement',
      'Raj Traders (CUST-A)',
      'Period: 15 Apr 2026 to 01 May 2026',
      'Generated: 2026-10-11 09:30 UTC',
      'Opening balance: INR 1,000.00',
      'Debits: INR 250.55',
      'Credits: INR 450.00',
      'Closing balance: INR 800.55',
      'From the customer ledger, for invoices reached through opportunities linked to this customer. A positive balance is an amount due from the customer.',
    ]);
  });

  it('says when the customer is inactive and when something is left out', () => {
    const lines = statementHeaderLines(
      statement({
        customer: {
          id: 'c',
          customerCode: 'CUST-C',
          customerName: 'Closed Co',
          isActive: false,
        },
        coverage: {
          postedInvoicesWithoutLedgerEntries: 2,
          unlinkedLegacyMatches: 1,
        },
      }),
    );
    expect(lines[1]).toBe('Closed Co (CUST-C) - inactive customer');
    expect(lines.slice(-2)).toEqual([
      'Note: 2 posted invoice(s) of this customer have no ledger entry and are not in this statement.',
      'Note: 1 opportunity(ies) look like this customer but are not linked to it; their invoices are not in this statement.',
    ]);
  });

  it('builds a PDF in memory, one page for a short statement', async () => {
    const pdf = await renderStatementPdf(statement());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(
      (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
    ).toBe(1);
  });

  it('continues over several pages for a long statement', async () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      id: `e${i}`,
      entryDate: '2026-04-15',
      salesInvoiceId: 'i',
      invoiceNumber: `INV-${i}`,
      debit: 100,
      credit: 0,
      runningBalance: 100 * (i + 1),
      remarks: `Row ${i} with a remark long enough to wrap onto a second line in the remarks column of the table`,
    }));
    const pdf = await renderStatementPdf(statement({ entries }), {
      compress: false,
    });
    expect(
      (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length,
    ).toBeGreaterThan(5);
  });

  it('an empty statement still renders', async () => {
    const pdf = await renderStatementPdf(statement({ entries: [] }));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
