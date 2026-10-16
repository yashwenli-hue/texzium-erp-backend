-- CRM: lead lifecycle v2 — Underqualified, call outcomes (CNC), and the person an
-- assignment event is about.
--
-- Additive and idempotent. No existing row is read, changed or backfilled.
--
--   "LeadStatus" gains UNDERQUALIFIED: contacted, but not yet a fit (it can still be
--     qualified, rejected, or taken back to Contacted).
--   "LeadTimeline"."outcome": what a CALL came to, CONNECTED or NOT_CONNECTED (a call
--     that did not connect, "CNC"). NULL on every other row and on every row recorded
--     before this column existed. The CHECK allows it only on a CALL activity.
--   "LeadTimeline"."subjectUserId": the person an assignment event is about (the
--     pre-sales assignee on PRE_SALES_ASSIGNED, the sales user on LEAD_QUALIFIED, the
--     person removed on LEAD_UNASSIGNED). NULL on older rows: their remarks name the
--     person, and that text is never turned back into an identity.
--
-- ALTER TYPE ... ADD VALUE runs outside the transaction (a new enum value cannot be
-- used in the transaction that adds it).
--
-- Apply BEFORE starting a backend built from this commit (its client knows the new
-- columns and value):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261019_crm_lead_lifecycle_v2.sql

ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'UNDERQUALIFIED';

BEGIN;

ALTER TABLE "LeadTimeline"
  ADD COLUMN IF NOT EXISTS "outcome" TEXT,
  ADD COLUMN IF NOT EXISTS "subjectUserId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadTimeline_subjectUserId_fkey') THEN
    ALTER TABLE "LeadTimeline"
      ADD CONSTRAINT "LeadTimeline_subjectUserId_fkey"
      FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadTimeline_outcome_check') THEN
    ALTER TABLE "LeadTimeline"
      ADD CONSTRAINT "LeadTimeline_outcome_check"
      CHECK ("outcome" IS NULL OR ("outcome" IN ('CONNECTED', 'NOT_CONNECTED') AND "activityType" = 'CALL'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "LeadTimeline_subjectUserId_idx" ON "LeadTimeline"("subjectUserId");

COMMIT;

-- Rollback.
-- 1. Code first: an older backend's Prisma client cannot read a lead whose status is
--    UNDERQUALIFIED. Before running an older build, move those leads (a data change
--    that needs its own approval), e.g.
--      UPDATE "Lead" SET "status" = 'CONTACTED' WHERE "status" = 'UNDERQUALIFIED';
-- 2. The columns (call outcomes and assignment subjects recorded since are lost):
--      BEGIN;
--      ALTER TABLE "LeadTimeline" DROP CONSTRAINT IF EXISTS "LeadTimeline_outcome_check";
--      ALTER TABLE "LeadTimeline" DROP CONSTRAINT IF EXISTS "LeadTimeline_subjectUserId_fkey";
--      DROP INDEX IF EXISTS "LeadTimeline_subjectUserId_idx";
--      ALTER TABLE "LeadTimeline" DROP COLUMN IF EXISTS "outcome", DROP COLUMN IF EXISTS "subjectUserId";
--      COMMIT;
-- 3. A PostgreSQL enum value cannot be dropped; UNDERQUALIFIED stays in the type, unused.
