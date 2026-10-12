import {
  fromPaise,
  toPaise,
} from '../payment-collections/payment-collection-values';
import {
  istCalendarDay,
  istDayStart,
  istNextDayStart,
} from '../../../core/dates/ist';

// A customer ledger statement, derived from CustomerLedger debit and credit amounts.
//
// The sign convention is the one every ledger writer applies (sales invoice posting
// and debit notes add a debit; payment collections and credit notes add a credit):
//
//   balance = previous balance + debit - credit       (positive = owed by the customer)
//
// The stored balanceAmount is NOT used: it is a running balance per customer NAME in
// insertion order, which is not the balance of one customer's rows in date order.
// Everything is summed in paise, as the payment collections do.

export const STATEMENT_ENTRY_LIMIT = 5000;

export interface StatementLedgerRow {
  id: string;
  salesInvoiceId: string;
  entryDate: Date;
  createdAt: Date;
  debitAmount: number;
  creditAmount: number;
  remarks: string | null;
}

export interface StatementEntry {
  id: string;
  entryDate: string;
  salesInvoiceId: string;
  invoiceNumber: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
  remarks: string | null;
}

export interface StatementFigures {
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  entries: StatementEntry[];
}

// Statement days are Indian calendar days (IST). A ledger date stored as
// midnight UTC of a day (how date-only values are stored) is that same day in
// India; a clock timestamp gets its Indian day.
export const calendarDay = (date: Date) => istCalendarDay(date);

// The period as entryDate bounds: from 00:00 IST on its first day (inclusive)
// to 00:00 IST on the day after its last day (exclusive), so both ends are
// whole Indian days.
export function periodBounds(from: string | null, to: string | null) {
  return {
    ...(from ? { gte: istDayStart(from) } : {}),
    ...(to ? { lt: istNextDayStart(to) } : {}),
  };
}

export const beforePeriod = (from: string) => ({ lt: istDayStart(from) });

// Debits minus credits, in paise.
export function netPaise(
  rows: Pick<StatementLedgerRow, 'debitAmount' | 'creditAmount'>[],
): number {
  return rows.reduce(
    (total, r) => total + toPaise(r.debitAmount) - toPaise(r.creditAmount),
    0,
  );
}

// Date order, then the order the rows were recorded, then id: stable for equal dates.
export function compareLedgerRows(
  a: StatementLedgerRow,
  b: StatementLedgerRow,
) {
  return (
    a.entryDate.getTime() - b.entryDate.getTime() ||
    a.createdAt.getTime() - b.createdAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// openingPaise: the net of every included row before the period. rows: the period's
// rows. Each entry carries the running balance after it.
export function buildStatementFigures(
  openingPaise: number,
  rows: StatementLedgerRow[],
  invoiceNumbers: ReadonlyMap<string, string | null>,
): StatementFigures {
  let running = openingPaise;
  let debits = 0;
  let credits = 0;

  const entries = [...rows].sort(compareLedgerRows).map((row) => {
    const debit = toPaise(row.debitAmount);
    const credit = toPaise(row.creditAmount);
    debits += debit;
    credits += credit;
    running += debit - credit;

    return {
      id: row.id,
      entryDate: calendarDay(row.entryDate),
      salesInvoiceId: row.salesInvoiceId,
      invoiceNumber: invoiceNumbers.get(row.salesInvoiceId) ?? null,
      debit: fromPaise(debit),
      credit: fromPaise(credit),
      runningBalance: fromPaise(running),
      remarks: row.remarks,
    };
  });

  return {
    openingBalance: fromPaise(openingPaise),
    totalDebits: fromPaise(debits),
    totalCredits: fromPaise(credits),
    closingBalance: fromPaise(running),
    entries,
  };
}
