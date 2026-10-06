// Values the Sales Order commercial workflow accepts. The payment types, modes
// and verification outcomes mirror the Prisma enums PaymentType, PaymentMode
// and PaymentVerificationStatus (a spec checks they stay in step); the models
// store them as plain text, so the DTOs are where they are enforced.

export const SALES_ORDER_PAYMENT_TYPES = [
  'FULL_ADVANCE',
  'PARTIAL_ADVANCE',
  'CREDIT',
] as const;

export const SALES_ORDER_PAYMENT_MODES = [
  'CASH',
  'CHEQUE',
  'BANK_TRANSFER',
  'RTGS',
  'NEFT',
  'IMPS',
  'UPI',
] as const;

// An advance receipt starts PENDING. Verification can only end it as one of
// these two; PENDING and UNDER_REVIEW exist in the enum but are not outcomes of
// a verification.
export const ADVANCE_RECEIPT_VERIFICATION_OUTCOMES = [
  'VERIFIED',
  'REJECTED',
] as const;

export type AdvanceReceiptVerificationOutcome =
  (typeof ADVANCE_RECEIPT_VERIFICATION_OUTCOMES)[number];

// Optional remarks on a lifecycle action or document.
export const SALES_ORDER_REMARKS_MAX_LENGTH = 500;

// The mandatory reason for a retraction or a cancellation (1 to this many
// characters once trimmed). It is stored as the lifecycle event's remarks.
export const SALES_ORDER_REASON_MAX_LENGTH = 500;

// Statuses a retraction leaves on the records it undoes. A retracted advance
// receipt goes back to PENDING (it is undecided again); an Accounts approval
// that is no longer in force is kept and marked RETRACTED.
export const ADVANCE_RECEIPT_PENDING_STATUS = 'PENDING';
export const ADVANCE_RECEIPT_VERIFIED_STATUS = 'VERIFIED';
export const COMMERCIAL_APPROVAL_APPROVED_STATUS = 'APPROVED';
export const COMMERCIAL_APPROVAL_RETRACTED_STATUS = 'RETRACTED';

// Short free-text fields such as a payment reference.
export const SALES_ORDER_REFERENCE_MAX_LENGTH = 100;
