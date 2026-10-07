-- CRM: governance of customer GST registrations.
--
-- Two additive, idempotent changes. No existing row is touched, and no
-- registration is deactivated, re-flagged or rewritten.
--
-- 1. "CustomerEvent"."gstRegistrationId": the GST registration a customer event
--    is about (added / edited / deactivated / reactivated / made the default).
--    Null on events about the customer itself. The foreign key is
--    ON DELETE SET NULL so history survives; registrations are never deleted
--    by the application.
--
-- 2. "CustomerGSTRegistration_one_default_key": at most one registration per
--    customer can be both active and the default. The application keeps the
--    stronger rule (a customer with any active registration has exactly one
--    active default); the index is the database's backstop. Prisma cannot
--    express a partial index, so it is managed only here.
--
-- The index cannot be built while a customer already has two active default
-- registrations. This script checks first and stops with a clear message,
-- changing nothing, rather than failing half way.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261008_crm_customer_gst_governance.sql

BEGIN;

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT count(*) INTO bad_count FROM (
    SELECT "customerId"
    FROM "CustomerGSTRegistration"
    WHERE "isDefault" AND "isActive"
    GROUP BY "customerId"
    HAVING count(*) > 1
  ) d;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'GST default uniqueness cannot be applied: % customer(s) have more than one active default registration. Resolve them first (nothing was changed).',
      bad_count;
  END IF;
END
$$;

ALTER TABLE "CustomerEvent" ADD COLUMN IF NOT EXISTS "gstRegistrationId" TEXT;

CREATE INDEX IF NOT EXISTS "CustomerEvent_gstRegistrationId_idx"
  ON "CustomerEvent" ("gstRegistrationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerEvent_gstRegistrationId_fkey'
  ) THEN
    ALTER TABLE "CustomerEvent"
      ADD CONSTRAINT "CustomerEvent_gstRegistrationId_fkey"
      FOREIGN KEY ("gstRegistrationId") REFERENCES "CustomerGSTRegistration" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerGSTRegistration_one_default_key"
  ON "CustomerGSTRegistration" ("customerId")
  WHERE "isDefault" AND "isActive";

COMMIT;

-- Rollback (drops the index and the column; events keep everything else):
--
-- BEGIN;
-- DROP INDEX IF EXISTS "CustomerGSTRegistration_one_default_key";
-- ALTER TABLE "CustomerEvent" DROP CONSTRAINT IF EXISTS "CustomerEvent_gstRegistrationId_fkey";
-- DROP INDEX IF EXISTS "CustomerEvent_gstRegistrationId_idx";
-- ALTER TABLE "CustomerEvent" DROP COLUMN IF EXISTS "gstRegistrationId";
-- COMMIT;
--
-- Dropping the column forgets which registration each GST event was about. Copy
-- it first if that must be kept:
--   CREATE TABLE "CustomerEventGst_backup" AS
--     SELECT "id", "gstRegistrationId" FROM "CustomerEvent"
--     WHERE "gstRegistrationId" IS NOT NULL;
