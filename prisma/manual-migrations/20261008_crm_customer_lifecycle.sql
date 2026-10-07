-- CRM: Customer lifecycle and history.
--
-- Adds, to the existing "Customer" table, the columns that describe a
-- deactivation, and adds the "CustomerEvent" table. Additive and idempotent:
-- running it again changes nothing. No existing column or row is touched, and
-- no customer is deactivated or rewritten.
--
-- "Customer"."isActive" already exists and stays the source of truth for
-- whether a customer is active. The new columns describe the CURRENT
-- deactivation (when, by whom, why) and are cleared when the customer is
-- reactivated; the permanent history is "CustomerEvent".
--
-- "CustomerEvent" holds one row per lifecycle event of a Customer: what
-- happened ("action"), the status before and after (ACTIVE / INACTIVE),
-- optional remarks (the reason, for a deactivation), for an edit the fields
-- that changed ("changes": { field: { from, to } }), and who did it
-- ("actorId", always the signed-in user). The actor foreign key is
-- ON DELETE SET NULL so history survives a deleted account.
--
-- No history is back-filled: customers that exist today simply have no events
-- until their next lifecycle action.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261008_crm_customer_lifecycle.sql

BEGIN;

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deactivatedAt"      TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deactivatedById"    TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "deactivationReason" TEXT;

CREATE INDEX IF NOT EXISTS "Customer_deactivatedById_idx"
  ON "Customer" ("deactivatedById");

CREATE TABLE IF NOT EXISTS "CustomerEvent" (
  "id"         TEXT         NOT NULL,
  "customerId" TEXT         NOT NULL,
  "action"     TEXT         NOT NULL,
  "fromStatus" TEXT,
  "toStatus"   TEXT,
  "remarks"    TEXT,
  "changes"    JSONB,
  "actorId"    TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomerEvent_customerId_occurredAt_idx"
  ON "CustomerEvent" ("customerId", "occurredAt");

CREATE INDEX IF NOT EXISTS "CustomerEvent_actorId_idx"
  ON "CustomerEvent" ("actorId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_deactivatedById_fkey'
  ) THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_deactivatedById_fkey"
      FOREIGN KEY ("deactivatedById") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerEvent_customerId_fkey'
  ) THEN
    ALTER TABLE "CustomerEvent"
      ADD CONSTRAINT "CustomerEvent_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerEvent_actorId_fkey'
  ) THEN
    ALTER TABLE "CustomerEvent"
      ADD CONSTRAINT "CustomerEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the table, every event in it, and the three columns):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "CustomerEvent";
-- ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_deactivatedById_fkey";
-- DROP INDEX IF EXISTS "Customer_deactivatedById_idx";
-- ALTER TABLE "Customer" DROP COLUMN IF EXISTS "deactivatedAt";
-- ALTER TABLE "Customer" DROP COLUMN IF EXISTS "deactivatedById";
-- ALTER TABLE "Customer" DROP COLUMN IF EXISTS "deactivationReason";
-- COMMIT;
--
-- Events and deactivation reasons are history that is not recorded anywhere
-- else. Copy them first if they must be kept:
--   CREATE TABLE "CustomerEvent_backup" AS SELECT * FROM "CustomerEvent";
--   CREATE TABLE "CustomerDeactivation_backup" AS
--     SELECT "id", "isActive", "deactivatedAt", "deactivatedById", "deactivationReason"
--     FROM "Customer";
