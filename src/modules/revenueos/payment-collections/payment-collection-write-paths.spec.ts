import * as fs from 'fs';
import * as path from 'path';

// Payment collections, their events and the receivable's paid figures are
// written by the collection command. These specs list every other place that
// writes the same tables, so that list cannot grow unnoticed: a new writer has to
// be added here on purpose, with the reason.

const SRC = path.resolve(__dirname, '../../..');

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });

const WRITES =
  '(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)';

const writersOf = (patterns: RegExp[]) => {
  const writers: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');

    if (patterns.some((p) => p.test(text))) writers.push(rel);
  }

  return writers.sort();
};

const COMMAND =
  'modules/revenueos/payment-collections/payment-collections.service.ts';

describe('who writes payment collections', () => {
  const PATTERNS = [
    new RegExp(String.raw`\.paymentCollection\s*\.\s*${WRITES}\b`),
    /\bpaymentCollections\s*:\s*\{\s*(create|createMany|connectOrCreate|update|upsert|delete)\b/,
    /INSERT\s+INTO\s+"?PaymentCollection"?(\s|\()/i,
    /UPDATE\s+"?PaymentCollection"?\s+SET\b/i,
  ];

  it('is the collection command, plus the FinanceOS duplicate that is not wired into the application', () => {
    expect(writersOf(PATTERNS)).toEqual([
      'modules/financeos/payment-collections/payment-collections.service.ts',
      COMMAND,
    ]);
  });
});

describe('who writes collection events', () => {
  it('only the collection command', () => {
    expect(
      writersOf([
        new RegExp(String.raw`\.paymentCollectionEvent\s*\.\s*${WRITES}\b`),
        /INSERT\s+INTO\s+"?PaymentCollectionEvent"?(\s|\()/i,
        /UPDATE\s+"?PaymentCollectionEvent"?\s+SET\b/i,
        /DELETE\s+FROM\s+"?PaymentCollectionEvent"?/i,
      ]),
    ).toEqual([COMMAND]);
  });
});

// KNOWN GAP, recorded here and reported at closeout: these FinanceOS and invoice
// paths also change a receivable's figures, outside the collection command. None
// of them takes the receivable row lock, and none of them is guarded. They are
// FinanceOS's to govern.
describe('who writes the receivable', () => {
  const PATTERNS = [
    new RegExp(String.raw`\.accountsReceivable\s*\.\s*${WRITES}\b`),
    /\baccountsReceivable\s*:\s*\{\s*(create|createMany|connectOrCreate|update|upsert|delete)\b/,
    /INSERT\s+INTO\s+"?AccountsReceivable"?(\s|\()/i,
    /UPDATE\s+"?AccountsReceivable"?\s+SET\b/i,
  ];

  it('is the collection command and the known writers outside it', () => {
    expect(writersOf(PATTERNS)).toEqual([
      'modules/financeos/accounts-receivable/accounts-receivable.service.ts',
      'modules/financeos/bad-debt-writeoff/bad-debt-writeoff.service.ts',
      'modules/financeos/credit-notes/credit-notes.service.ts',
      'modules/financeos/debit-notes/debit-notes.service.ts',
      'modules/financeos/payment-collections/payment-collections.service.ts',
      COMMAND,
      'modules/revenueos/sales-invoices/sales-invoices.service.ts',
    ]);
  });
});
