// Values the Quotation lifecycle accepts and the tolerance it checks amounts
// against.

// Optional remarks on an approval or a revision.
export const QUOTATION_REMARKS_MAX_LENGTH = 500;

// The mandatory reason for a rejection (1 to this many characters once
// trimmed). It is stored as the lifecycle event's remarks.
export const QUOTATION_REASON_MAX_LENGTH = 500;

// The largest taxable amount a revision accepts. It only guards against an
// absurd value; the quotation itself is not capped anywhere else.
export const QUOTATION_MAX_TAXABLE_AMOUNT = 1_000_000_000_000;

// Quotation amounts are stored as floating-point numbers, so two figures that
// should match may differ by floating-point noise. Amounts are compared to
// within a paisa.
export const QUOTATION_AMOUNT_TOLERANCE = 0.01;
