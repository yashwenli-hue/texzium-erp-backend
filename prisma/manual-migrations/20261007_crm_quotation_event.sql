-- CRM: Quotation lifecycle history.
--
-- Adds the "QuotationEvent" table. Additive and idempotent: running it again
-- changes nothing, and no existing table, column or row is touched (the
-- Quotation and User tables only gain a relation in the Prisma schema, not a
-- column).
--
-- One row per lifecycle event of a Quotation: what happened ("action"), the
-- status before and after, optional remarks (the reason, for a rejection), and
-- who did it ("actorId", always the signed-in user). A revision also records
-- the taxable and total amounts before and after it. The actor foreign key is
-- ON DELETE SET NULL so history survives a deleted account.
--
-- No history is back-filled: quotations that exist today simply have no events
-- until their next lifecycle action.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261007_crm_quotation_event.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "QuotationEvent" (
  "id"                    TEXT             NOT NULL,
  "quotationId"           TEXT             NOT NULL,
  "action"                TEXT             NOT NULL,
  "fromStatus"            TEXT,
  "toStatus"              TEXT,
  "remarks"               TEXT,
  "previousTaxableAmount" DOUBLE PRECISION,
  "newTaxableAmount"      DOUBLE PRECISION,
  "previousTotalAmount"   DOUBLE PRECISION,
  "newTotalAmount"        DOUBLE PRECISION,
  "actorId"               TEXT,
  "occurredAt"            TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuotationEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "QuotationEvent_quotationId_occurredAt_idx"
  ON "QuotationEvent" ("quotationId", "occurredAt");

CREATE INDEX IF NOT EXISTS "QuotationEvent_actorId_idx"
  ON "QuotationEvent" ("actorId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QuotationEvent_quotationId_fkey'
  ) THEN
    ALTER TABLE "QuotationEvent"
      ADD CONSTRAINT "QuotationEvent_quotationId_fkey"
      FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'QuotationEvent_actorId_fkey'
  ) THEN
    ALTER TABLE "QuotationEvent"
      ADD CONSTRAINT "QuotationEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the table and every event in it):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "QuotationEvent";
-- COMMIT;
--
-- Events are history that is not recorded anywhere else. Copy them first if
-- they must be kept:
--   CREATE TABLE "QuotationEvent_backup" AS SELECT * FROM "QuotationEvent";
