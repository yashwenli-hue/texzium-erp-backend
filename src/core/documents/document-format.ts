import { isCalendarDay, istCalendarDay } from '../dates/ist';

// How values are written on business documents. These only format values the
// document was given; they never calculate an amount.

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

// "01 Apr 2026": a calendar day ("YYYY-MM-DD") as given, or the Indian calendar
// day of an instant.
export function formatDocumentDate(value: Date | string): string {
  const day =
    typeof value === 'string' && isCalendarDay(value)
      ? value
      : istCalendarDay(value instanceof Date ? value : new Date(value));
  const [y, m, d] = day.split('-');
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

// "26 Oct 2026, 14:05 IST"
export function formatDocumentTimestamp(at: Date): string {
  const ist = new Date(at.getTime() + 330 * 60 * 1000).toISOString();
  return `${formatDocumentDate(at)}, ${ist.slice(11, 16)} IST`;
}

// Indian digit grouping of a whole number written in digits: 1,23,45,678
function groupIndian(digits: string): string {
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return rest ? `${rest},${last3}` : last3;
}

function toPaise(amount: number): number {
  return Math.round(Math.abs(amount) * 100);
}

// "1,23,456.70" (two decimals, Indian grouping, "-" for a negative amount).
export function formatAmount(amount: number): string {
  const paise = toPaise(amount);
  const rupees = groupIndian(Math.floor(paise / 100).toString());
  const decimals = (paise % 100).toString().padStart(2, '0');
  return `${amount < 0 && paise > 0 ? '-' : ''}${rupees}.${decimals}`;
}

// "₹1,23,456.70"
export function formatInr(amount: number): string {
  const text = formatAmount(amount);
  return text.startsWith('-') ? `-₹${text.slice(1)}` : `₹${text}`;
}

// A quantity: up to three decimals, trailing zeros dropped, Indian grouping.
export function formatQuantity(quantity: number): string {
  const fixed = Math.abs(quantity)
    .toFixed(3)
    .replace(/\.?0+$/, '');
  const [whole, frac] = fixed.split('.');
  return `${quantity < 0 ? '-' : ''}${groupIndian(whole)}${frac ? `.${frac}` : ''}`;
}

// "18%", "2.5%"
export function formatPercent(rate: number): string {
  return `${Number(rate.toFixed(3))}%`;
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t}-${ONES[n % 10]}` : t;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? belowHundred(r) : '']
    .filter(Boolean)
    .join(' ');
}

// A whole number in words in the Indian system (thousand, lakh, crore).
function indianWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}

// "Indian Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and
// Seventy Paise Only"
export function amountInWordsInr(amount: number): string {
  const paise = toPaise(amount);
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const words = `Indian Rupees ${indianWords(rupees)}${p ? ` and ${belowHundred(p)} Paise` : ''} Only`;
  return amount < 0 && paise > 0 ? `Minus ${words}` : words;
}
