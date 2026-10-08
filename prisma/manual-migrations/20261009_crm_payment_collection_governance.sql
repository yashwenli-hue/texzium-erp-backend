-- CRM: govern payment collections.
--
-- Additive and idempotent. No existing row is changed: legacy collections keep
-- a null recorder and have no events, and no receivable, ledger or invoice
-- row is rewritten. Before anything is created the script checks that the
-- existing data satisfies the new rules and stops, changing nothing, if it
-- does not.
--
-- 1. "PaymentCollection"."recordedById": the user who recorded the payment.
--    Null on collections recorded before the actor was kept.
--
-- 2. "PaymentCollectionEvent": what happened to a collection and what it did to
--    the receivable (who, when, amount, balance and status before and after).
--    One PAYMENT_RECORDED event is written in the same transaction as every new
--    collection. Collections that already exist have no events; none are made up.
--
-- 3. Integrity rules the database now enforces:
--      - "PaymentCollection"."amount" > 0
--      - "AccountsReceivable"."paidAmount" >= 0
--      - one receivable per invoice (unique "AccountsReceivable"."salesInvoiceId")
--      - one reference per receivable, case-insensitively and ignoring
--        surrounding spaces (partial unique index on "PaymentCollection")
--    There is deliberately NO check on "balanceAmount": a legacy written-off
--    receivable carries a negative balance, and legacy data is not corrected here.
--    The unique index is created here and not declared in schema.prisma, so the
--    Prisma relation SalesInvoice.receivables keeps its list type.
--
-- Apply (permissions are a separate file, 20261009_crm_payment_collection_permissions.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261009_crm_payment_collection_governance.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AccountsReceivable" GROUP BY "salesInvoiceId" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one receivable per invoice: some invoice has more than one receivable.';
  END IF;

  IF EXISTS (SELECT 1 FROM "PaymentCollection" WHERE "amount" <= 0) THEN
    RAISE EXCEPTION 'Cannot require a positive collection amount: a collection has an amount of zero or less.';
  END IF;

  IF EXISTS (SELECT 1 FROM "AccountsReceivable" WHERE "paidAmount" < 0) THEN
    RAISE EXCEPTION 'Cannot require a non-negative paid amount: a receivable has a negative paid amount.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "PaymentCollection"
    WHERE "referenceNumber" IS NOT NULL AND btrim("referenceNumber") <> ''
    GROUP BY "accountsReceivableId", lower(btrim("referenceNumber"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot require unique references: a receivable already has two collections with the same reference.';
  END IF;
END
$$;

-- 1. Who recorded the payment.
ALTER TABLE "PaymentCollection" ADD COLUMN IF NOT EXISTS "recordedById" TEXT;

CREATE INDEX IF NOT EXISTS "PaymentCollection_accountsReceivableId_paymentDate_idx"
  ON "PaymentCollection" ("accountsReceivableId", "paymentDate");

CREATE INDEX IF NOT EXISTS "PaymentCollection_recordedById_idx"
  ON "PaymentCollection" ("recordedById");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollection_recordedById_fkey') THEN
    ALTER TABLE "PaymentCollection"
      ADD CONSTRAINT "PaymentCollection_recordedById_fkey"
      FOREIGN KEY ("recordedById") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- 2. The event history.
CREATE TABLE IF NOT EXISTS "PaymentCollectionEvent" (
  "id"                   TEXT             NOT NULL,
  "paymentCollectionId"  TEXT             NOT NULL,
  "accountsReceivableId" TEXT             NOT NULL,
  "salesInvoiceId"       TEXT             NOT NULL,
  "action"               TEXT             NOT NULL,
  "amount"               DOUBLE PRECISION NOT NULL,
  "balanceBefore"        DOUBLE PRECISION NOT NULL,
  "balanceAfter"         DOUBLE PRECISION NOT NULL,
  "fromStatus"           TEXT,
  "toStatus"             TEXT,
  "remarks"              TEXT,
  "actorId"              TEXT             NOT NULL,
  "occurredAt"           TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"            TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentCollectionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaymentCollectionEvent_accountsReceivableId_occurredAt_idx"
  ON "PaymentCollectionEvent" ("accountsReceivableId", "occurredAt");
CREATE INDEX IF NOT EXISTS "PaymentCollectionEvent_paymentCollectionId_idx"
  ON "PaymentCollectionEvent" ("paymentCollectionId");
CREATE INDEX IF NOT EXISTS "PaymentCollectionEvent_salesInvoiceId_idx"
  ON "PaymentCollectionEvent" ("salesInvoiceId");
CREATE INDEX IF NOT EXISTS "PaymentCollectionEvent_actorId_idx"
  ON "PaymentCollectionEvent" ("actorId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollectionEvent_paymentCollectionId_fkey') THEN
    ALTER TABLE "PaymentCollectionEvent"
      ADD CONSTRAINT "PaymentCollectionEvent_paymentCollectionId_fkey"
      FOREIGN KEY ("paymentCollectionId") REFERENCES "PaymentCollection" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollectionEvent_accountsReceivableId_fkey') THEN
    ALTER TABLE "PaymentCollectionEvent"
      ADD CONSTRAINT "PaymentCollectionEvent_accountsReceivableId_fkey"
      FOREIGN KEY ("accountsReceivableId") REFERENCES "AccountsReceivable" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollectionEvent_actorId_fkey') THEN
    ALTER TABLE "PaymentCollectionEvent"
      ADD CONSTRAINT "PaymentCollectionEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

-- 3. Integrity rules.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentCollection_amount_positive') THEN
    ALTER TABLE "PaymentCollection"
      ADD CONSTRAINT "PaymentCollection_amount_positive" CHECK ("amount" > 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountsReceivable_paidAmount_nonnegative') THEN
    ALTER TABLE "AccountsReceivable"
      ADD CONSTRAINT "AccountsReceivable_paidAmount_nonnegative" CHECK ("paidAmount" >= 0);
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "AccountsReceivable_salesInvoiceId_key"
  ON "AccountsReceivable" ("salesInvoiceId");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentCollection_receivable_reference_key"
  ON "PaymentCollection" ("accountsReceivableId", lower(btrim("referenceNumber")))
  WHERE "referenceNumber" IS NOT NULL AND btrim("referenceNumber") <> '';

COMMIT;

-- Rollback (removes everything above; the event history is lost, collections,
-- receivables and the ledger are not touched):
--
-- BEGIN;
-- DROP INDEX IF EXISTS "PaymentCollection_receivable_reference_key";
-- DROP INDEX IF EXISTS "AccountsReceivable_salesInvoiceId_key";
-- ALTER TABLE "AccountsReceivable" DROP CONSTRAINT IF EXISTS "AccountsReceivable_paidAmount_nonnegative";
-- ALTER TABLE "PaymentCollection" DROP CONSTRAINT IF EXISTS "PaymentCollection_amount_positive";
-- DROP TABLE IF EXISTS "PaymentCollectionEvent";
-- ALTER TABLE "PaymentCollection" DROP CONSTRAINT IF EXISTS "PaymentCollection_recordedById_fkey";
-- DROP INDEX IF EXISTS "PaymentCollection_recordedById_idx";
-- DROP INDEX IF EXISTS "PaymentCollection_accountsReceivableId_paymentDate_idx";
-- ALTER TABLE "PaymentCollection" DROP COLUMN IF EXISTS "recordedById";
-- COMMIT;
--
-- Who recorded a payment, and the events, exist nowhere else. Copy them first if
-- they must be kept:
--   CREATE TABLE "PaymentCollectionEvent_backup" AS SELECT * FROM "PaymentCollectionEvent";
--   CREATE TABLE "PaymentCollectionRecorder_backup" AS
--     SELECT "id", "recordedById" FROM "PaymentCollection" WHERE "recordedById" IS NOT NULL;
