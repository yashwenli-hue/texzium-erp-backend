// Limits and format rules for the Customer master. Shared by the DTOs and the
// service so they cannot drift apart.

export const CUSTOMER_NAME_MAX_LENGTH = 200;
export const CUSTOMER_TYPE_MAX_LENGTH = 50;
export const CUSTOMER_EMAIL_MAX_LENGTH = 254;
export const CUSTOMER_REASON_MAX_LENGTH = 500;

// A PAN is five letters, four digits and a letter (e.g. ABCDE1234F). It is
// stored upper-case.
export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Digits with the usual separators, 7 to 20 characters. It is a sanity check on
// typing, not a numbering-plan validation.
export const PHONE_PATTERN = /^\+?[0-9][0-9()\-\s]{5,18}[0-9]$/;

// The fields of a Customer a person edits. The code, the lifecycle and the
// vendor link are not among them.
export const CUSTOMER_EDITABLE_FIELDS = [
  'customerName',
  'customerType',
  'panNumber',
  'email',
  'phone',
] as const;

export type CustomerEditableField = (typeof CUSTOMER_EDITABLE_FIELDS)[number];

// "CUST-000001". Numbers above 999999 simply grow longer.
export const CUSTOMER_CODE_PREFIX = 'CUST-';
export const CUSTOMER_CODE_DIGITS = 6;

export function formatCustomerCode(sequenceNumber: number | bigint): string {
  return `${CUSTOMER_CODE_PREFIX}${String(sequenceNumber).padStart(CUSTOMER_CODE_DIGITS, '0')}`;
}

// How two names are compared for "the same customer": surrounding space
// ignored, runs of whitespace collapsed, case ignored. The database applies the
// same rule (lower(regexp_replace(btrim(x), '[[:space:]]+', ' ', 'g'))), so what is
// shown here is what is enforced there. There is no fuzzy matching: "Raj
// Traders" and "Raj Traders Pvt Ltd" are different names.
export function normalizeCustomerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizePan(pan: string): string {
  return pan.trim().toUpperCase();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Digits only. Two phone numbers are "the same" for a duplicate warning when
// their last ten digits match and each has at least seven digits.
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function samePhone(a: string, b: string): boolean {
  const x = phoneDigits(a);
  const y = phoneDigits(b);

  return x.length >= 7 && y.length >= 7 && x.slice(-10) === y.slice(-10);
}

export type CustomerChange = { from: string | null; to: string | null };
export type CustomerChanges = Partial<
  Record<CustomerEditableField, CustomerChange>
>;

// The fields an edit actually changes: only those present in the request
// whose value differs from the stored one. `undefined` in the request means
// "leave it"; `null` means "clear it". The result is also what is written to
// the event.
export function diffCustomerFields(
  current: Record<CustomerEditableField, string | null>,
  requested: Partial<Record<CustomerEditableField, string | null>>,
): CustomerChanges {
  const changes: CustomerChanges = {};

  for (const field of CUSTOMER_EDITABLE_FIELDS) {
    const next = requested[field];

    if (next === undefined) continue;
    if (next === current[field]) continue;

    changes[field] = { from: current[field], to: next };
  }

  return changes;
}
