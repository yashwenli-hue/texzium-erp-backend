import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { indianFinancialYear, istCalendarDay } from '../../../core/dates/ist';

// Consecutive document numbers for business documents.
//
// A number is "<series code><GST state code>/<financial year>/<sequence>", for
// example SI24/26-27/00001 (sales invoice, Gujarat registration, FY 2026-27,
// first number). Without a registration scope the state code is left out
// (RC/26-27/00001). Every number is at most 16 characters of letters, digits,
// "/" and "-", unique for its series and financial year (GST Rule 46(b) for tax
// invoices).
//
// The number is taken inside the caller's transaction with one atomic
// INSERT ... ON CONFLICT DO UPDATE on the series' counter row. Concurrent
// documents of the same series wait for each other on that row, and a document
// whose transaction rolls back gives its number back, so a series has no gaps
// and no duplicates. Always call it inside the transaction that creates the
// document.

export const DOCUMENT_NUMBER_TYPE = {
  SALES_INVOICE: 'SALES_INVOICE',
  QUOTATION: 'QUOTATION',
  PROFORMA_INVOICE: 'PROFORMA_INVOICE',
  PAYMENT_RECEIPT: 'PAYMENT_RECEIPT',
} as const;

export type DocumentNumberType =
  (typeof DOCUMENT_NUMBER_TYPE)[keyof typeof DOCUMENT_NUMBER_TYPE];

const SERIES_CODE: Record<DocumentNumberType, string> = {
  SALES_INVOICE: 'SI',
  QUOTATION: 'QT',
  PROFORMA_INVOICE: 'PI',
  PAYMENT_RECEIPT: 'RC',
};

const DOCUMENT_LABEL: Record<DocumentNumberType, string> = {
  SALES_INVOICE: 'sales invoice',
  QUOTATION: 'quotation',
  PROFORMA_INVOICE: 'Proforma Invoice',
  PAYMENT_RECEIPT: 'payment receipt',
};

export const DOCUMENT_NUMBER_MAX_LENGTH = 16;
export const DOCUMENT_SEQUENCE_DIGITS = 5;
export const DOCUMENT_SEQUENCE_MAX = 10 ** DOCUMENT_SEQUENCE_DIGITS - 1;
export const COMPANY_SCOPE_KEY = 'COMPANY';

const NUMBER_PATTERN = /^[A-Za-z0-9/-]+$/;
const STATE_CODE_PATTERN = /^\d{2}$/;

// Which series a document belongs to: one per seller GST registration (its
// state code goes into the number), or one for the whole company.
export type DocumentNumberScope =
  | { kind: 'registration'; gstRegistrationId: string; stateCode: string }
  | { kind: 'company' };

function scopeKey(scope: DocumentNumberScope): string {
  return scope.kind === 'company' ? COMPANY_SCOPE_KEY : scope.gstRegistrationId;
}

// "SI24/26-27/": everything before the sequence number.
export function documentNumberPrefix(
  type: DocumentNumberType,
  scope: DocumentNumberScope,
  financialYearShort: string,
): string {
  let state = '';
  if (scope.kind === 'registration') {
    if (!STATE_CODE_PATTERN.test(scope.stateCode)) {
      throw new Error(`Not a GST state code: ${scope.stateCode}`);
    }
    state = scope.stateCode;
  }
  return `${SERIES_CODE[type]}${state}/${financialYearShort}/`;
}

export function formatDocumentNumber(
  type: DocumentNumberType,
  scope: DocumentNumberScope,
  financialYearShort: string,
  sequence: number,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Not a sequence number: ${sequence}`);
  }
  if (sequence > DOCUMENT_SEQUENCE_MAX) {
    throw new ConflictException(
      `The ${DOCUMENT_LABEL[type]} number series for financial year ${financialYearShort} is full (${DOCUMENT_SEQUENCE_MAX} numbers). No ${DOCUMENT_LABEL[type]} was created.`,
    );
  }
  const number =
    documentNumberPrefix(type, scope, financialYearShort) +
    String(sequence).padStart(DOCUMENT_SEQUENCE_DIGITS, '0');
  if (
    number.length > DOCUMENT_NUMBER_MAX_LENGTH ||
    !NUMBER_PATTERN.test(number)
  ) {
    throw new Error(`Invalid document number: ${number}`);
  }
  return number;
}

export type AllocatedDocumentNumber = {
  number: string;
  prefix: string;
  sequence: number;
  financialYear: string;
};

// Takes the next number of the document's series. `documentDate` is the
// document's own date; its Indian calendar day decides the financial year.
export async function allocateDocumentNumber(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  type: DocumentNumberType,
  scope: DocumentNumberScope,
  documentDate: Date,
): Promise<AllocatedDocumentNumber> {
  const fy = indianFinancialYear(istCalendarDay(documentDate));
  const prefix = documentNumberPrefix(type, scope, fy.short);

  const rows = await tx.$queryRaw<Array<{ lastNumber: number }>>`
    /* document-number:allocate */
    INSERT INTO "DocumentNumberCounter"
      ("id", "documentType", "scopeKey", "financialYear", "lastNumber", "updatedAt")
    VALUES
      (gen_random_uuid()::text, ${type}, ${scopeKey(scope)}, ${fy.label}, 1, CURRENT_TIMESTAMP)
    ON CONFLICT ("documentType", "scopeKey", "financialYear")
    DO UPDATE SET
      "lastNumber" = "DocumentNumberCounter"."lastNumber" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
    RETURNING "lastNumber"
  `;

  const sequence = Number(rows[0]?.lastNumber);
  return {
    number: formatDocumentNumber(type, scope, fy.short, sequence),
    prefix,
    sequence,
    financialYear: fy.label,
  };
}
