import type { CustomerStatement } from './customer-statements.service';
import {
  periodLabel,
  renderStatementPdf,
  statementDocument,
  statementNotices,
} from './statement-pdf.renderer';
import type { DocumentIssuer } from '../../adminos/document-profile/document-identity';
import {
  collapse,
  pdfPageTexts,
} from '../../../core/documents/pdf-text.helper-spec';

const issuer: DocumentIssuer = {
  identity: {
    legalName: 'Texzium Industries Private Limited',
    addressLines: ['Plot 7, GIDC', 'Ahmedabad 382445'],
    details: ['GSTIN 24AAACT1234A1Z5 · Gujarat (24)'],
  },
  legalName: 'Texzium Industries Private Limited',
  registration: null,
  bankLines: [],
  terms: { quotation: [], proforma: [], invoice: [], receipt: [] },
  signatory: { name: null, designation: null },
};

const statement = (
  over: Partial<CustomerStatement> = {},
): CustomerStatement => ({
  customer: {
    id: 'c',
    customerCode: 'CUST-A',
    customerName: 'राज Traders',
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
      invoiceNumber: 'SI24/26-27/00001',
      debit: 0,
      credit: 400,
      runningBalance: 600,
      remarks: 'Payment received UTR1',
    },
  ],
  coverage: { postedInvoicesWithoutLedgerEntries: 0, unlinkedLegacyMatches: 0 },
  generatedAt: '2026-10-11T19:30:00.000Z',
  ...over,
});

describe('statement PDF', () => {
  it('labels the period with Indian calendar days', () => {
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

  it('says when the customer is inactive and when something is left out', () => {
    expect(statementNotices(statement())).toEqual([]);
    expect(
      statementNotices(
        statement({
          customer: { ...statement().customer, isActive: false },
          coverage: {
            postedInvoicesWithoutLedgerEntries: 2,
            unlinkedLegacyMatches: 1,
          },
        }),
      ),
    ).toEqual([
      'This customer is inactive.',
      '2 posted invoice(s) of this customer have no ledger entry and are not in this statement.',
      '1 opportunity(ies) look like this customer but are not linked to it; their invoices are not in this statement.',
    ]);
  });

  it('prints the statement figures exactly as given, on the shared layout, dated in IST', async () => {
    const pdf = await renderStatementPdf(statement(), issuer, {
      compress: false,
    });
    const text = collapse(pdfPageTexts(pdf).join(' '));
    for (const expected of [
      'Texzium Industries Private Limited',
      'Customer Statement',
      'राज Traders',
      'Customer code CUST-A',
      'Period 15 Apr 2026 to 01 May 2026',
      // generated 19:30 UTC on 11 Oct = 01:00 IST on 12 Oct
      'Statement date 12 Oct 2026',
      '15 Apr 2026 SI24/26-27/00001 Payment received UTR1 400.00 600.00',
      'Opening balance ₹1,000.00',
      'Debits ₹250.55',
      'Credits ₹450.00',
      'Closing balance ₹800.55',
      'Page 1 of 1',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('continues over several pages for a long statement, with the table header on each', async () => {
    const entries = Array.from({ length: 120 }, (_, i) => ({
      ...statement().entries[0],
      id: `l${i}`,
      remarks: `Entry ${i + 1}`,
    }));
    const pages = pdfPageTexts(
      await renderStatementPdf(statement({ entries }), issuer, {
        compress: false,
      }),
    );
    expect(pages.length).toBeGreaterThan(1);
    for (const p of pages)
      expect(collapse(p)).toContain(
        'Date Invoice Remarks Debit Credit Balance',
      );
    expect(collapse(pages.join(' '))).toContain('Entry 120');
  });

  it('an empty statement still renders and says so', async () => {
    const doc = statementDocument(statement({ entries: [] }), issuer);
    expect(doc.table?.rows).toEqual([]);
    const text = collapse(
      pdfPageTexts(
        await renderStatementPdf(statement({ entries: [] }), issuer, {
          compress: false,
        }),
      )[0],
    );
    expect(text).toContain('No ledger entries in this period.');
  });
});
