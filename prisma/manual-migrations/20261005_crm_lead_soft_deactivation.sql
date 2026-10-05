-- CRM: soft deactivation of leads (no delete, no new LeadStatus value).
--
-- Additive and non-destructive. Every existing lead becomes isActive = true;
-- no existing column is altered or dropped.
--
-- Apply order:
--   1. this file
--   2. 20261005_crm_lead_deactivate_permission.sql
--   3. npx prisma generate, then start a backend built from this change
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261005_crm_lead_soft_deactivation.sql
--
-- The deactivated* columns describe the CURRENT deactivation and are cleared on
-- reactivation. Permanent history lives in "LeadTimeline" (LEAD_DEACTIVATED /
-- LEAD_REACTIVATED). There is deliberately no CHECK constraint: deleting a user
-- sets deactivatedById to NULL, and the service keeps the fields consistent.

BEGIN;

ALTER TABLE "Lead"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "deactivatedAt" TIMESTAMP(3),
ADD COLUMN "deactivatedById" TEXT,
ADD COLUMN "deactivationReason" TEXT;

ALTER TABLE "Lead"
ADD CONSTRAINT "Lead_deactivatedById_fkey"
FOREIGN KEY ("deactivatedById")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "Lead_deactivatedById_idx"
ON "Lead"("deactivatedById");

COMMIT;

-- Rollback (discards deactivation state; deactivated leads become active again.
-- LEAD_DEACTIVATED / LEAD_REACTIVATED timeline rows are kept):
--
-- BEGIN;
-- DROP INDEX "Lead_deactivatedById_idx";
-- ALTER TABLE "Lead" DROP CONSTRAINT "Lead_deactivatedById_fkey";
-- ALTER TABLE "Lead"
--   DROP COLUMN "deactivationReason",
--   DROP COLUMN "deactivatedById",
--   DROP COLUMN "deactivatedAt",
--   DROP COLUMN "isActive";
-- COMMIT;
