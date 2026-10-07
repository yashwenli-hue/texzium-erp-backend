-- CRM: Customer code sequence and PAN uniqueness.
--
-- Two additive, idempotent database objects. No existing row is touched.
--
-- 1. "customer_code_seq": the source of new customer codes. The application
--    asks it for the next number and formats it as CUST-000001, CUST-000002,
--    and so on. A sequence is atomic, so two simultaneous creations can never
--    be given the same number. It is gap-tolerant: a number taken by a
--    transaction that later fails is not given out again. Customer codes that
--    exist today (CUST001, CUST-<timestamp>) are left exactly as they are, and
--    a code is never changed once it has been given.
--
-- 2. "Customer_panNumber_normalized_key": a unique index on the upper-cased,
--    trimmed PAN, ignoring customers without one. It is the database's backstop
--    for "one customer per PAN"; the application checks first and reports a
--    readable conflict. Prisma cannot express an expression index, so it is
--    managed only here.
--
-- The index cannot be built while two customers already share a PAN. This
-- script checks first and stops with a clear message, changing nothing, rather
-- than failing half way.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261008_crm_customer_code_and_pan.sql

BEGIN;

CREATE SEQUENCE IF NOT EXISTS customer_code_seq AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1;

DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT upper(btrim("panNumber"))
    FROM "Customer"
    WHERE "panNumber" IS NOT NULL AND btrim("panNumber") <> ''
    GROUP BY upper(btrim("panNumber"))
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Customer PAN uniqueness cannot be applied: % PAN value(s) are shared by more than one customer. Resolve them first (nothing was changed).',
      dup_count;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_panNumber_normalized_key"
  ON "Customer" (upper(btrim("panNumber")))
  WHERE "panNumber" IS NOT NULL AND btrim("panNumber") <> '';

COMMIT;

-- Rollback (drops the index and the sequence; codes already given stay):
--
-- BEGIN;
-- DROP INDEX IF EXISTS "Customer_panNumber_normalized_key";
-- DROP SEQUENCE IF EXISTS customer_code_seq;
-- COMMIT;
--
-- Dropping the sequence forgets the last number given. Before re-creating it,
-- start it above the highest CUST-<number> code in use, or new codes will clash
-- (the unique index on "customerCode" would refuse them).
