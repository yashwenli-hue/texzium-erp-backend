-- CRM: BANT analysis of a lead (Budget, Authority, Need, Timeline).
--
-- Additive and idempotent. A new table only; no existing row is read, changed or
-- backfilled. Leads already handed to Sales are not affected. From this version on, a
-- lead is qualified and handed to Sales only once its BANT is complete, so open
-- Pre-Sales leads need their BANT answered first.
--
--   "LeadBant": one row per lead. Each answer is an option value from
--     src/modules/revenueos/lead-bant/bant-questions.ts (checked below); "score"
--     (0-100) is worked out by the server from the answers; "completedAt" is set while
--     all four are answered.
--
-- Apply BEFORE starting a backend built from this commit (its client knows the table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261121_lead_bant.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "LeadBant" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "budget" TEXT,
    "budgetAmount" DOUBLE PRECISION,
    "budgetNote" TEXT,
    "authority" TEXT,
    "authorityNote" TEXT,
    "need" TEXT,
    "needNote" TEXT,
    "timeline" TEXT,
    "timelineNote" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LeadBant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeadBant_leadId_key" ON "LeadBant"("leadId");
CREATE INDEX IF NOT EXISTS "LeadBant_updatedById_idx" ON "LeadBant"("updatedById");

-- The rules, each added once (also onto a table created by `prisma db push`).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_budget_check') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_budget_check"
      CHECK ("budget" IS NULL OR "budget" IN ('CONFIRMED', 'INDICATIVE', 'UNKNOWN', 'NONE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_authority_check') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_authority_check"
      CHECK ("authority" IS NULL OR "authority" IN ('DECISION_MAKER', 'INFLUENCER', 'USER_ONLY', 'UNKNOWN'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_need_check') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_need_check"
      CHECK ("need" IS NULL OR "need" IN ('URGENT', 'DEFINED', 'EXPLORING', 'NONE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_timeline_check') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_timeline_check"
      CHECK ("timeline" IS NULL OR "timeline" IN ('WITHIN_1_MONTH', 'WITHIN_3_MONTHS', 'WITHIN_6_MONTHS', 'LATER'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_score_check') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_score_check"
      CHECK ("score" BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_budgetAmount_check') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_budgetAmount_check"
      CHECK ("budgetAmount" IS NULL OR "budgetAmount" >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_complete_check') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_complete_check"
      CHECK (("completedAt" IS NULL) = ("budget" IS NULL OR "authority" IS NULL OR "need" IS NULL OR "timeline" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_leadId_fkey') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_leadId_fkey"
      FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LeadBant_updatedById_fkey') THEN
    ALTER TABLE "LeadBant" ADD CONSTRAINT "LeadBant_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
