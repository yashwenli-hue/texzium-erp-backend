import {
  buildStatementFigures,
  calendarDay,
  netPaise,
  periodBounds,
  StatementLedgerRow,
} from './statement-calculator';

const row = (
  id: string,
  entryDate: string,
  debitAmount: number,
  creditAmount: number,
  createdAt = `${entryDate}T10:00:00.000Z`,
  salesInvoiceId = 'inv-1',
): StatementLedgerRow => ({
  id,
  salesInvoiceId,
  entryDate: new Date(`${entryDate}T00:00:00.000Z`),
  createdAt: new Date(createdAt),
  debitAmount,
  creditAmount,
  remarks: `remark ${id}`,
});

const inBounds = (date: Date, b: ReturnType<typeof periodBounds>) =>
  (!b.gte || date >= b.gte) && (!b.lt || date < b.lt);

describe('statement calculator', () => {
  it('follows the ledger convention: debits add, credits subtract, running balance per entry', () => {
    const f = buildStatementFigures(
      0,
      [row('a', '2026-04-01', 1000, 0), row('b', '2026-04-15', 0, 400)],
      new Map([['inv-1', 'INV-1']]),
    );
    expect(f.entries.map((e) => [e.debit, e.credit, e.runningBalance])).toEqual(
      [
        [1000, 0, 1000],
        [0, 400, 600],
      ],
    );
    expect(f).toMatchObject({
      openingBalance: 0,
      totalDebits: 1000,
      totalCredits: 400,
      closingBalance: 600,
    });
    expect(f.entries[0]).toMatchObject({
      entryDate: '2026-04-01',
      invoiceNumber: 'INV-1',
      remarks: 'remark a',
    });
  });

  it('starts from the opening balance and ends at opening + debits - credits', () => {
    const f = buildStatementFigures(
      60000,
      [row('a', '2026-05-01', 250.55, 50)],
      new Map(),
    );
    expect(f.openingBalance).toBe(600);
    expect(f.closingBalance).toBe(800.55);
    expect(f.entries[0].runningBalance).toBe(800.55);
  });

  it('orders by entry date, then recording time, then id - whatever order the rows come in', () => {
    const rows = [
      // same day: recorded at 09:00 ('q') before 12:00 ('p'), although 'p' < 'q' by id
      row('p', '2026-05-01', 0, 50, '2026-05-01T12:00:00.000Z'),
      row('q', '2026-05-01', 250, 0, '2026-05-01T09:00:00.000Z'),
      row('b', '2026-04-01', 10, 0, '2026-04-01T09:00:00.000Z'),
      row('a', '2026-04-01', 20, 0, '2026-04-01T09:00:00.000Z'),
    ];
    expect(
      buildStatementFigures(0, rows, new Map()).entries.map((e) => e.id),
    ).toEqual(['a', 'b', 'q', 'p']);
  });

  it('sums in paise, so 0.1 + 0.2 is exactly 0.3', () => {
    const f = buildStatementFigures(
      0,
      [row('a', '2026-04-01', 0.1, 0), row('b', '2026-04-02', 0.2, 0)],
      new Map(),
    );
    expect(f.closingBalance).toBe(0.3);
    expect(
      netPaise([
        { debitAmount: 0.1, creditAmount: 0 },
        { debitAmount: 0.2, creditAmount: 0 },
      ]),
    ).toBe(30);
  });

  it('shows an overpayment as a negative balance', () => {
    const f = buildStatementFigures(
      0,
      [row('a', '2026-04-01', 100, 0), row('b', '2026-04-02', 0, 150)],
      new Map(),
    );
    expect(f.closingBalance).toBe(-50);
  });

  it('never uses the stored balanceAmount', () => {
    const r = {
      ...row('a', '2026-04-01', 100, 0),
      balanceAmount: 999999,
    } as StatementLedgerRow;
    expect(buildStatementFigures(0, [r], new Map()).closingBalance).toBe(100);
  });

  it('an empty period keeps the opening balance as the closing balance', () => {
    expect(buildStatementFigures(12345, [], new Map())).toEqual({
      openingBalance: 123.45,
      totalDebits: 0,
      totalCredits: 0,
      closingBalance: 123.45,
      entries: [],
    });
  });

  describe('period bounds (whole calendar days, both ends inclusive)', () => {
    const d = (iso: string) => new Date(iso);

    it('all time when neither end is given', () => {
      expect(periodBounds(null, null)).toEqual({});
    });

    it('includes the first day from midnight and the last day until its last millisecond', () => {
      const b = periodBounds('2026-04-15', '2026-05-01');
      expect(inBounds(d('2026-04-14T23:59:59.999Z'), b)).toBe(false);
      expect(inBounds(d('2026-04-15T00:00:00.000Z'), b)).toBe(true);
      expect(inBounds(d('2026-05-01T00:00:00.000Z'), b)).toBe(true);
      expect(inBounds(d('2026-05-01T23:59:59.999Z'), b)).toBe(true);
      expect(inBounds(d('2026-05-02T00:00:00.000Z'), b)).toBe(false);
    });

    it('a single day is one whole day', () => {
      const b = periodBounds('2026-04-15', '2026-04-15');
      expect(inBounds(d('2026-04-15T00:00:00.000Z'), b)).toBe(true);
      expect(inBounds(d('2026-04-16T00:00:00.000Z'), b)).toBe(false);
    });

    it('open-ended on either side', () => {
      expect(
        inBounds(
          d('1990-01-01T00:00:00.000Z'),
          periodBounds(null, '2026-04-15'),
        ),
      ).toBe(true);
      expect(
        inBounds(
          d('2099-01-01T00:00:00.000Z'),
          periodBounds('2026-04-15', null),
        ),
      ).toBe(true);
    });

    it('crosses month and year ends and leap days correctly', () => {
      expect(periodBounds('2024-02-29', '2024-12-31')).toEqual({
        gte: d('2024-02-29T00:00:00.000Z'),
        lt: d('2025-01-01T00:00:00.000Z'),
      });
    });

    it('reads a stored date as its UTC calendar day', () => {
      expect(calendarDay(d('2026-04-15T00:00:00.000Z'))).toBe('2026-04-15');
    });
  });
});
