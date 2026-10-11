import PDFDocument from 'pdfkit';

import type { CustomerStatement } from './customer-statements.service';

// The statement as a PDF, built in memory (nothing is written to disk) with pdfkit's
// standard fonts. Those only cover Latin-1, so amounts are written "INR 1,23,456.00"
// and any other character in a name or remark is shown as "?". Text is only ever
// drawn as text: nothing in a name or remark is interpreted.

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// "2026-04-01" -> "01 Apr 2026" (a calendar day; no time zone involved).
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// Indian digit grouping: 1,23,45,678.90
export function formatInr(amount: number): string {
  const paise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(paise / 100).toString();
  const decimals = (paise % 100).toString().padStart(2, '0');
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  return `INR ${amount < 0 && paise > 0 ? '-' : ''}${grouped}.${decimals}`;
}

// Safe text for the standard fonts: no control characters, Latin-1 only, bounded.
export function pdfText(value: string | null | undefined, max = 200): string {
  const clean = Array.from(value ?? '', (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return ' '; // control characters
    return code > 0xff ? '?' : ch; // outside Latin-1: the standard fonts cannot draw it
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

export function periodLabel(s: Pick<CustomerStatement, 'period'>): string {
  const { from, to } = s.period;
  if (from && to) return `${formatDay(from)} to ${formatDay(to)}`;
  if (from) return `From ${formatDay(from)}`;
  if (to) return `Up to ${formatDay(to)}`;
  return 'All time';
}

// The heading and summary lines, in order (also what the tests read back).
export function statementHeaderLines(s: CustomerStatement): string[] {
  const c = s.customer;
  const coverage: string[] = [];
  if (s.coverage.postedInvoicesWithoutLedgerEntries > 0)
    coverage.push(
      `Note: ${s.coverage.postedInvoicesWithoutLedgerEntries} posted invoice(s) of this customer have no ledger entry and are not in this statement.`,
    );
  if (s.coverage.unlinkedLegacyMatches > 0)
    coverage.push(
      `Note: ${s.coverage.unlinkedLegacyMatches} opportunity(ies) look like this customer but are not linked to it; their invoices are not in this statement.`,
    );

  return [
    'Customer statement',
    `${pdfText(c.customerName, 120)} (${pdfText(c.customerCode, 40)})${c.isActive ? '' : ' - inactive customer'}`,
    `Period: ${periodLabel(s)}`,
    `Generated: ${s.generatedAt.slice(0, 16).replace('T', ' ')} UTC`,
    `Opening balance: ${formatInr(s.openingBalance)}`,
    `Debits: ${formatInr(s.totalDebits)}`,
    `Credits: ${formatInr(s.totalCredits)}`,
    `Closing balance: ${formatInr(s.closingBalance)}`,
    'From the customer ledger, for invoices reached through opportunities linked to this customer. A positive balance is an amount due from the customer.',
    ...coverage,
  ];
}

const COLUMNS = [
  { key: 'date', label: 'Date', width: 58, align: 'left' },
  { key: 'invoice', label: 'Invoice', width: 82, align: 'left' },
  { key: 'remarks', label: 'Remarks', width: 165, align: 'left' },
  { key: 'debit', label: 'Debit', width: 70, align: 'right' },
  { key: 'credit', label: 'Credit', width: 70, align: 'right' },
  { key: 'balance', label: 'Balance', width: 70, align: 'right' },
] as const;

export function renderStatementPdf(
  s: CustomerStatement,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 40,
    bufferPages: true,
    compress: options.compress ?? true,
    info: { Title: 'Customer statement', Producer: 'Texzium RevenueOS' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;
  const [title, customer, ...summary] = statementHeaderLines(s);

  doc.font('Helvetica-Bold').fontSize(16).text(title);
  doc.font('Helvetica-Bold').fontSize(11).text(customer);
  doc.font('Helvetica').fontSize(9);
  for (const line of summary) doc.text(line, { width: 515 });
  doc.moveDown(0.8);

  const tableHeader = () => {
    let x = left;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5);
    for (const col of COLUMNS) {
      doc.text(col.label, x, y, { width: col.width - 4, align: col.align });
      x += col.width;
    }
    doc
      .moveTo(left, doc.y + 2)
      .lineTo(left + 515, doc.y + 2)
      .stroke();
    doc.y += 5;
    doc.font('Helvetica').fontSize(8.5);
  };

  const row = (cells: Record<(typeof COLUMNS)[number]['key'], string>) => {
    const height = Math.max(
      ...COLUMNS.map((c) =>
        doc.heightOfString(cells[c.key], { width: c.width - 4 }),
      ),
    );
    if (doc.y + height > bottom()) {
      doc.addPage();
      tableHeader();
    }
    const y = doc.y;
    let x = left;
    for (const col of COLUMNS) {
      doc.text(cells[col.key], x, y, {
        width: col.width - 4,
        align: col.align,
      });
      x += col.width;
    }
    doc.y = y + height + 3;
  };

  tableHeader();
  row({
    date: '',
    invoice: '',
    remarks: 'Opening balance',
    debit: '',
    credit: '',
    balance: formatInr(s.openingBalance),
  });
  if (s.entries.length === 0) {
    row({
      date: '',
      invoice: '',
      remarks: 'No ledger entries in this period.',
      debit: '',
      credit: '',
      balance: '',
    });
  }
  for (const e of s.entries) {
    row({
      date: formatDay(e.entryDate),
      invoice: pdfText(e.invoiceNumber ?? '-', 30),
      remarks: pdfText(e.remarks, 200),
      debit: e.debit ? formatInr(e.debit) : '',
      credit: e.credit ? formatInr(e.credit) : '',
      balance: formatInr(e.runningBalance),
    });
  }
  row({
    date: '',
    invoice: '',
    remarks: 'Closing balance',
    debit: formatInr(s.totalDebits),
    credit: formatInr(s.totalCredits),
    balance: formatInr(s.closingBalance),
  });

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i += 1) {
    doc.switchToPage(pages.start + i);
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        `Page ${i + 1} of ${pages.count}`,
        left,
        doc.page.height - doc.page.margins.bottom - 10,
        { width: 515, align: 'right', lineBreak: false },
      );
  }

  doc.end();
  return done;
}
