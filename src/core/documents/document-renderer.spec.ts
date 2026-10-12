import { renderDocumentPdf, DocumentSpec } from './document-renderer';
import {
  amountInWordsInr,
  formatAmount,
  formatDocumentDate,
  formatInr,
  formatPercent,
  formatQuantity,
} from './document-format';
import { safeFileName, safeLines, safeText } from './document-text';
import { textRuns } from './document-fonts';
import { collapse, pdfPageTexts } from './pdf-text.helper-spec';

const base = (over: Partial<DocumentSpec> = {}): DocumentSpec => ({
  title: 'Tax Invoice',
  subtitle: 'Original for recipient',
  runningTitle: 'Tax Invoice SI24/26-27/00001',
  identity: {
    legalName: 'Texzium Industries Private Limited',
    tradeName: 'Texzium',
    addressLines: ['Plot 7, GIDC', 'Ahmedabad 380015'],
    details: ['GSTIN 24AAACT1234A1Z5 · Gujarat (24)'],
  },
  meta: [
    ['Invoice no.', 'SI24/26-27/00001'],
    ['Date', '07 Oct 2026'],
  ],
  parties: [
    {
      heading: 'Bill to',
      name: 'राज Traders',
      lines: ['GSTIN 27AAAPL1234C1ZV'],
    },
  ],
  table: {
    columns: [
      { key: 'n', label: '#', width: 1 },
      { key: 'd', label: 'Description', width: 6, wrap: true },
      { key: 'a', label: 'Amount', width: 3, align: 'right' },
    ],
    rows: [{ n: '1', d: 'Industrial pump', a: '1,00,000.00' }],
  },
  totals: [{ label: 'Total', value: '₹1,18,000.00', strong: true }],
  generatedAt: new Date('2026-10-12T08:30:00Z'),
  ...over,
});

describe('document formatting', () => {
  it('writes amounts in Indian grouping with two decimals', () => {
    expect(formatAmount(123456.7)).toBe('1,23,456.70');
    expect(formatAmount(12345678.9)).toBe('1,23,45,678.90');
    expect(formatAmount(0)).toBe('0.00');
    expect(formatAmount(-1000)).toBe('-1,000.00');
    expect(formatInr(118000)).toBe('₹1,18,000.00');
    expect(formatInr(-5.5)).toBe('-₹5.50');
    expect(formatAmount(0.004)).toBe('0.00');
  });

  it('writes quantities, rates and dates', () => {
    expect(formatQuantity(1000)).toBe('1,000');
    expect(formatQuantity(2.5)).toBe('2.5');
    expect(formatQuantity(1.125)).toBe('1.125');
    expect(formatPercent(18)).toBe('18%');
    expect(formatPercent(2.5)).toBe('2.5%');
    expect(formatDocumentDate('2026-04-01')).toBe('01 Apr 2026');
    // an instant is written as its Indian calendar day
    expect(formatDocumentDate(new Date('2026-06-30T18:30:00Z'))).toBe(
      '01 Jul 2026',
    );
  });

  it('writes an amount in words in the Indian system', () => {
    expect(amountInWordsInr(123456.7)).toBe(
      'Indian Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Seventy Paise Only',
    );
    expect(amountInWordsInr(10_00_00_000)).toBe('Indian Rupees Ten Crore Only');
    expect(amountInWordsInr(1_23_45_67_890.05)).toBe(
      'Indian Rupees One Hundred Twenty-Three Crore Forty-Five Lakh Sixty-Seven Thousand Eight Hundred Ninety and Five Paise Only',
    );
    expect(amountInWordsInr(0)).toBe('Indian Rupees Zero Only');
  });
});

describe('safe document text', () => {
  it('turns control characters into spaces, removes bidirectional overrides, collapses whitespace', () => {
    expect(safeText('a\u0000b\tc\n\nd‮evil‬  e')).toBe('a b c devil e');
  });

  it('shortens at a whole character, never inside a Devanagari conjunct', () => {
    expect(safeText('क्षत्रिय', 2)).toBe('क्ष…');
    expect(safeText('x'.repeat(10), 5)).toBe('xxxx…');
  });

  it('keeps meaningful line breaks for addresses and terms', () => {
    expect(safeLines('Line 1\r\n\r\n  Line\t2  \nLine 3', 2)).toEqual([
      'Line 1',
      'Line 2',
    ]);
    expect(safeLines(undefined)).toEqual([]);
  });

  it('makes a safe file name', () => {
    expect(safeFileName(['invoice', 'SI24/26-27/00001'], 'pdf')).toBe(
      'invoice-SI24_26-27_00001.pdf',
    );
    expect(safeFileName(['../../etc', 'passwd'], 'pdf')).toBe(
      '.._.._etc-passwd.pdf',
    );
    expect(safeFileName([], 'pdf')).toBe('document.pdf');
  });

  it('switches font per run: Devanagari with Noto Sans Devanagari, the rest with Noto Sans; unknown characters become "?"', () => {
    expect(textRuns('राज Traders ₹100')).toEqual([
      { text: 'राज ', font: 'DocDeva' },
      { text: 'Traders ₹100', font: 'DocSans' },
    ]);
    expect(textRuns('O’Brien – “Ltd”')).toEqual([
      { text: 'O’Brien – “Ltd”', font: 'DocSans' },
    ]);
    // Tamil is drawn by neither font
    expect(textRuns('A தமிழ்')[0].text).toBe(
      'A ????????'.slice(0, 2 + 'தமிழ்'.length),
    );
  });
});

describe('the document layout', () => {
  it('draws the header, details, parties, table and totals, with the page number', async () => {
    const [page] = pdfPageTexts(
      await renderDocumentPdf(base(), { compress: false }),
    );
    const text = collapse(page);
    for (const expected of [
      'Texzium Industries Private Limited',
      'Plot 7, GIDC',
      'GSTIN 24AAACT1234A1Z5 · Gujarat (24)',
      'Tax Invoice',
      'Original for recipient',
      'Invoice no. SI24/26-27/00001',
      'BILL TO',
      'राज Traders',
      'Industrial pump',
      '1,00,000.00',
      'Total ₹1,18,000.00',
      'Page 1 of 1',
      'Generated 12 Oct 2026, 14:00 IST',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('repeats the table header and the running title on every page, and numbers the pages', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({
      n: String(i + 1),
      d: `Line item ${i + 1}`,
      a: formatAmount(i * 100),
    }));
    const pages = pdfPageTexts(
      await renderDocumentPdf(base({ table: { ...base().table!, rows } }), {
        compress: false,
      }),
    );
    expect(pages.length).toBeGreaterThanOrEqual(2);
    pages.forEach((p, i) => {
      expect(p).toContain(`Page ${i + 1} of ${pages.length}`);
      expect(collapse(p)).toContain('# Description Amount');
      if (i > 0) expect(p).toContain('Tax Invoice SI24/26-27/00001');
    });
    const all = collapse(pages.join(' '));
    expect(all).toContain('Line item 1 ');
    expect(all).toContain('Line item 70 ');
  });

  it('draws notices, sections, the signature area and a watermark on every page', async () => {
    const pdf = await renderDocumentPdf(
      base({
        watermark: 'DRAFT',
        notices: ['Line details were not recorded for this quotation.'],
        sections: [{ heading: 'Bank details', lines: ['A/c 1234567890'] }],
        signature: {
          forName: 'Texzium Industries Private Limited',
          name: 'A. Mehta',
          designation: 'Director',
        },
        footerNote: 'This is a computer-generated document.',
      }),
      { compress: false },
    );
    const text = collapse(pdfPageTexts(pdf).join(' '));
    expect(text).toContain(
      'Line details were not recorded for this quotation.',
    );
    expect(text).toContain('Bank details A/c 1234567890');
    expect(text).toContain('For Texzium Industries Private Limited');
    expect(text).toContain('Authorised Signatory · Director');
    expect(text).toContain('DRAFT');
    expect(text).toContain('This is a computer-generated document.');
  });

  it('an empty table says so', async () => {
    const pdf = await renderDocumentPdf(
      base({ table: { ...base().table!, rows: [], emptyText: 'No entries.' } }),
      { compress: false },
    );
    expect(collapse(pdfPageTexts(pdf)[0])).toContain('No entries.');
  });

  it('an unreadable logo is left out and the document is still produced', async () => {
    const pdf = await renderDocumentPdf(
      base({
        identity: { ...base().identity, logo: Buffer.from('not an image') },
      }),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('embeds only the fonts it uses, as subsets, and keeps the file small', async () => {
    const pdf = await renderDocumentPdf(base());
    expect(pdf.length).toBeLessThan(80_000);
    expect(pdf.toString('latin1')).toMatch(/\/FontFile2/);
  });
});
