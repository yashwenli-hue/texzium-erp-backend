-- CRM: link an Opportunity to a Customer.
--
-- Two additive, idempotent changes. No existing row is touched: every
-- existing opportunity keeps no customer until a person links one, and no
-- opportunity, quotation or customer is rewritten.
--
-- 1. "Opportunity"."customerId": the customer a deal is for. It is set only by
--    the explicit link action (or when an opportunity is created with one) and
--    is locked once a quotation exists. Every document further down the chain
--    (quotation, proforma, sales order) takes its customer from here, so no
--    customer column is added to them. The foreign key is ON DELETE RESTRICT:
--    customers are deactivated, never deleted.
--
-- 2. "CustomerEvent"."opportunityId": the opportunity a customer event is about
--    (linked / unlinked). Null on every other event. ON DELETE SET NULL so
--    history survives.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261008_crm_opportunity_customer.sql

BEGIN;

ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "customerId" TEXT;

CREATE INDEX IF NOT EXISTS "Opportunity_customerId_idx"
  ON "Opportunity" ("customerId");

ALTER TABLE "CustomerEvent" ADD COLUMN IF NOT EXISTS "opportunityId" TEXT;

CREATE INDEX IF NOT EXISTS "CustomerEvent_opportunityId_idx"
  ON "CustomerEvent" ("opportunityId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Opportunity_customerId_fkey'
  ) THEN
    ALTER TABLE "Opportunity"
      ADD CONSTRAINT "Opportunity_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "Customer" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CustomerEvent_opportunityId_fkey'
  ) THEN
    ALTER TABLE "CustomerEvent"
      ADD CONSTRAINT "CustomerEvent_opportunityId_fkey"
      FOREIGN KEY ("opportunityId") REFERENCES "Opportunity" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (drops both columns; links and the events about them are lost):
--
-- BEGIN;
-- ALTER TABLE "CustomerEvent" DROP CONSTRAINT IF EXISTS "CustomerEvent_opportunityId_fkey";
-- DROP INDEX IF EXISTS "CustomerEvent_opportunityId_idx";
-- ALTER TABLE "CustomerEvent" DROP COLUMN IF EXISTS "opportunityId";
-- ALTER TABLE "Opportunity" DROP CONSTRAINT IF EXISTS "Opportunity_customerId_fkey";
-- DROP INDEX IF EXISTS "Opportunity_customerId_idx";
-- ALTER TABLE "Opportunity" DROP COLUMN IF EXISTS "customerId";
-- COMMIT;
--
-- A link is a business decision that is recorded nowhere else. Copy it first
-- if it must be kept:
--   CREATE TABLE "OpportunityCustomer_backup" AS
--     SELECT "id", "customerId" FROM "Opportunity" WHERE "customerId" IS NOT NULL;
