// Calendar days in India Standard Time (UTC+05:30 all year; no daylight saving).
//
// Business documents are dated by the Indian calendar day. A date-only value
// that the API received as "YYYY-MM-DD" is stored as midnight UTC of that day,
// which is 05:30 IST on the same day, so reading it back in IST gives the day
// that was sent. A timestamp taken from the clock (e.g. 23:30 IST, stored as
// 18:00 UTC) is also given its correct Indian day.

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// True for a real calendar day written "YYYY-MM-DD".
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_PATTERN.test(value)) return false;
  const at = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

function requireDay(day: string): void {
  if (!isCalendarDay(day))
    throw new Error(`Not a calendar day: ${String(day)}`);
}

// The Indian calendar day ("YYYY-MM-DD") of an instant.
export function istCalendarDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// The instant an Indian calendar day starts (00:00 IST).
export function istDayStart(day: string): Date {
  requireDay(day);
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - IST_OFFSET_MS);
}

// The instant the Indian calendar day after `day` starts.
export function istNextDayStart(day: string): Date {
  return new Date(istDayStart(day).getTime() + DAY_MS);
}

// The Indian financial year (1 April to 31 March) that contains a calendar day:
// label "2026-27", short "26-27".
export function indianFinancialYear(day: string): {
  label: string;
  short: string;
  startYear: number;
} {
  requireDay(day);
  const [year, month] = day.split('-').map(Number);
  const startYear = month >= 4 ? year : year - 1;
  const two = (n: number) => String(n % 100).padStart(2, '0');
  return {
    label: `${startYear}-${two(startYear + 1)}`,
    short: `${two(startYear)}-${two(startYear + 1)}`,
    startYear,
  };
}
