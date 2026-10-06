-- CRM: persisted opportunity stage.
--
-- Opportunity.status now holds the stage: QUALIFIED, PROPOSAL, NEGOTIATION,
-- WON or LOST. It used to be a plain string that was always 'OPEN'. No column or
-- table is added. This migration:
--   1. refuses to run if any row holds a value other than OPEN or one of the
--      five stages (nothing is changed in that case),
--   2. turns every existing 'OPEN' row into 'QUALIFIED', and
--   3. makes 'QUALIFIED' the column default.
--
-- Idempotent: running it again changes nothing. "updatedAt" is left alone because
-- this is a clean-up of a value that never carried meaning, not a user action,
-- and no timeline rows are written for the same reason.
--
-- Apply this BEFORE deploying the code that uses the stage: the stage endpoint
-- answers 409 for a row that still reads OPEN.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261006_crm_opportunity_stage.sql

BEGIN;

DO $$
DECLARE
  unexpected text;
BEGIN
  SELECT string_agg(DISTINCT "status", ', ')
    INTO unexpected
    FROM "Opportunity"
   WHERE "status" NOT IN ('OPEN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

  IF unexpected IS NOT NULL THEN
    RAISE EXCEPTION 'Opportunity.status has unexpected values (%). Resolve them before applying this migration.', unexpected;
  END IF;
END
$$;

UPDATE "Opportunity" SET "status" = 'QUALIFIED' WHERE "status" = 'OPEN';

ALTER TABLE "Opportunity" ALTER COLUMN "status" SET DEFAULT 'QUALIFIED';

COMMIT;

-- Rollback (restores the old default and flattens every row back to 'OPEN'):
--
-- BEGIN;
-- ALTER TABLE "Opportunity" ALTER COLUMN "status" SET DEFAULT 'OPEN';
-- UPDATE "Opportunity" SET "status" = 'OPEN';
-- COMMIT;
--
-- The rollback discards any stage reached since the migration (PROPOSAL,
-- NEGOTIATION, WON, LOST). Those moves are still on record as
-- OPPORTUNITY_STAGE_CHANGED rows in "LeadTimeline"; keep a copy of
--   SELECT "id", "status" FROM "Opportunity";
-- before rolling back if the exact stages must be restored.
