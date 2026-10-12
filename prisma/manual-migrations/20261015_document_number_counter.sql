-- Documents: consecutive numbering series.
--
-- Adds the "DocumentNumberCounter" table. Additive and idempotent: running it
-- again changes nothing, and no existing table, column or row is touched.
--
-- One row per numbering series: a document type (SALES_INVOICE, QUOTATION,
-- PROFORMA_INVOICE, PAYMENT_RECEIPT), a scope (the seller GST registration id,
-- or 'COMPANY') and an Indian financial year ('2026-27'). "lastNumber" is the
-- last sequence number issued. A number is taken with an atomic
-- INSERT ... ON CONFLICT DO UPDATE inside the transaction that creates the
-- document, so concurrent documents queue on the row and a rolled-back
-- document gives its number back: numbers are consecutive with no gaps.
--
-- No row is created here and no existing document is numbered: documents
-- created before this change keep the numbers (or the absence of a number)
-- they have.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261015_document_number_counter.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "DocumentNumberCounter" (
  "id"            TEXT         NOT NULL,
  "documentType"  TEXT         NOT NULL,
  "scopeKey"      TEXT         NOT NULL,
  "financialYear" TEXT         NOT NULL,
  "lastNumber"    INTEGER      NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DocumentNumberCounter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentNumberCounter_lastNumber_check" CHECK ("lastNumber" >= 0),
  CONSTRAINT "DocumentNumberCounter_financialYear_check" CHECK ("financialYear" ~ '^[0-9]{4}-[0-9]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentNumberCounter_documentType_scopeKey_financialYear_key"
  ON "DocumentNumberCounter" ("documentType", "scopeKey", "financialYear");

COMMIT;

-- Rollback (removes the counters; numbers already printed on documents stay
-- on those documents, so only roll back before any numbered document exists,
-- or numbering would restart at 1):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "DocumentNumberCounter";
-- COMMIT;
