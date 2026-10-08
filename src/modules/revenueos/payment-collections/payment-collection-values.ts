import { ConflictException } from '@nestjs/common';
import { registerDecorator, ValidationOptions } from 'class-validator';

// Payment collection rules that more than one file needs. Pure: nothing here
// reads the database.

// What a payment can be paid with. Input is normalised first, so "Bank Transfer"
// and "bank-transfer" both mean BANK_TRANSFER. Collections recorded before this
// list existed keep whatever text they were saved with.
export const PAYMENT_MODES = [
  'CASH',
  'BANK_TRANSFER',
  'UPI',
  'CHEQUE',
  'CARD',
  'OTHER',
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_REFERENCE_MAX_LENGTH = 100;
export const PAYMENT_REMARKS_MAX_LENGTH = 500;
export const PAYMENT_AMOUNT_MAX = 1_000_000_000;
export const COLLECTIONS_LIST_DEFAULT_LIMIT = 100;
export const COLLECTIONS_LIST_MAX_LIMIT = 500;

// A payment may be dated up to one day ahead: the person's date can be a day
// ahead of the server's (India against UTC).
export const PAYMENT_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// AccountsReceivable.paymentStatus values this code reads and writes. WRITTEN_OFF
// is set by FinanceOS; it is only ever read here.
export const RECEIVABLE_STATUS = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  WRITTEN_OFF: 'WRITTEN_OFF',
} as const;

// A payment can only be taken against a receivable in one of these.
export const RECEIVABLE_PAYABLE_STATUSES: readonly string[] = [
  RECEIVABLE_STATUS.PENDING,
  RECEIVABLE_STATUS.PARTIAL,
];

export const INVOICE_STATUS_POSTED = 'POSTED';

export const PAYMENT_COLLECTION_EVENT_ACTION = {
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
} as const;

// Stable codes a client can act on. The message is for people.
export const PAYMENT_CONFLICT_CODE = {
  OVERPAYMENT: 'OVERPAYMENT',
  RECEIVABLE_CLOSED: 'RECEIVABLE_CLOSED',
  INVOICE_NOT_POSTED: 'INVOICE_NOT_POSTED',
  DUPLICATE_REFERENCE: 'DUPLICATE_REFERENCE',
  RECEIVABLE_CHANGED: 'RECEIVABLE_CHANGED',
  RECEIVABLE_BUSY: 'RECEIVABLE_BUSY',
  LEDGER_CUSTOMER_MISSING: 'LEDGER_CUSTOMER_MISSING',
  AMBIGUOUS_RECEIVABLE: 'AMBIGUOUS_RECEIVABLE',
} as const;

export type PaymentConflictCode =
  (typeof PAYMENT_CONFLICT_CODE)[keyof typeof PAYMENT_CONFLICT_CODE];

export const INVOICE_NOT_FOUND_MESSAGE = 'Sales invoice not found.';
export const RECEIVABLE_NOT_FOUND_MESSAGE =
  'This invoice has no receivable to collect against.';
export const PAYMENT_COLLECTION_NOT_FOUND_MESSAGE =
  'Payment collection not found.';

export function paymentConflict(
  message: string,
  code: PaymentConflictCode,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}

// ---------------------------------------------------------------------------
// Money. Amounts are Float columns holding rupees; every comparison and every
// sum is done in whole paise so 0.1 + 0.2 style drift cannot decide a payment.
// ---------------------------------------------------------------------------

export const toPaise = (rupees: number): number => Math.round(rupees * 100);

export const fromPaise = (paise: number): number => paise / 100;

export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

// "Bank Transfer", " bank-transfer " and "BANK_TRANSFER" are the same mode.
export function normalizePaymentMode(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  return value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

// Two references are the same payment if they only differ in case or in the
// spaces around them. This mirrors the database's unique index.
export const referenceKey = (reference: string): string =>
  reference.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

// A rupee amount: a finite number of at most two decimal places and at least
// one paisa. Exact, with no tolerance: a number typed with at most two decimals
// is the same double as its whole-paise value divided by 100. (class-validator's
// own maxDecimalPlaces cannot be used: it throws on exponent forms such as 1e-7,
// which would surface as a 500.)
export function isRupeeAmount(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;

  return value >= 0.01 && Math.round(value * 100) / 100 === value;
}

export function IsRupeeAmount(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isRupeeAmount',
      target: object.constructor,
      propertyName,
      options: {
        message:
          'amountReceived must be an amount of at least 0.01 with at most two decimal places',
        ...options,
      },
      validator: { validate: (value: unknown) => isRupeeAmount(value) },
    });
  };
}

// A payment cannot be dated in the future (beyond the tolerance above).
export function isNotFutureDate(value: unknown, now = new Date()): boolean {
  if (typeof value !== 'string') return false;

  const time = Date.parse(value);

  if (Number.isNaN(time)) return false;

  return time <= now.getTime() + PAYMENT_DATE_TOLERANCE_MS;
}

export function IsNotFuturePaymentDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isNotFuturePaymentDate',
      target: object.constructor,
      propertyName,
      options: {
        message: 'The payment date cannot be in the future.',
        ...options,
      },
      validator: {
        // Text that is not a date at all is IsDateString's to report, so a person
        // sees one message about it, not two.
        validate: (value: unknown) =>
          typeof value !== 'string' ||
          Number.isNaN(Date.parse(value)) ||
          isNotFutureDate(value),
      },
    });
  };
}
