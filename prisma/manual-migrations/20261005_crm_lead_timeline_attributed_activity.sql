-- CRM: attributed, typed employee activity on LeadTimeline.
--
-- Additive and non-destructive. Every existing LeadTimeline row becomes
-- source = SYSTEM with no activityType/actorId, and gets occurredAt = createdAt.
-- No existing column is altered or dropped.
--
-- Apply BEFORE starting a backend built from this commit, then run
-- `npx prisma generate`:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261005_crm_lead_timeline_attributed_activity.sql
--
-- Optional pre-check: rows written through the earlier, uncommitted
-- POST /leads/:id/timeline route (free-text action codes such as 'Call') would
-- be classified SYSTEM by this migration. List any action codes outside the
-- known system set (LEAD_ASSIGNED is a legacy system code still present in data):
--   SELECT action, count(*) FROM "LeadTimeline"
--   WHERE action NOT IN ('LEAD_CREATED','LEAD_UPDATED','STATUS_UPDATED','PRE_SALES_ASSIGNED',
--     'LEAD_ASSIGNED','LEAD_QUALIFIED','LEAD_REJECTED','OPPORTUNITY_CREATED','FOLLOWUP_CREATED',
--     'FOLLOWUP_COMPLETED','FOLLOWUP_RESCHEDULED','FOLLOWUP_CANCELLED','LEAD_IMPORTED')
--   GROUP BY action;
-- Any such row is an employee entry from before attribution existed. To keep
-- it visible as employee activity (with no recorded author) run, after this
-- migration, a statement like:
--   UPDATE "LeadTimeline" SET "source" = 'EMPLOYEE', "activityType" = 'CALL'
--   WHERE "action" = 'Call' AND "source" = 'SYSTEM';

BEGIN;

CREATE TYPE "LeadTimelineSource" AS ENUM ('SYSTEM', 'EMPLOYEE');

CREATE TYPE "LeadActivityType" AS ENUM (
  'NOTE',
  'CALL',
  'MEETING',
  'EMAIL',
  'WHATSAPP',
  'REQUIREMENT',
  'OTHER'
);

ALTER TABLE "LeadTimeline"
ADD COLUMN "source" "LeadTimelineSource" NOT NULL DEFAULT 'SYSTEM',
ADD COLUMN "activityType" "LeadActivityType",
ADD COLUMN "actorId" TEXT,
ADD COLUMN "occurredAt" TIMESTAMP(3);

-- Historical rows: the event time is the time the row was recorded.
UPDATE "LeadTimeline" SET "occurredAt" = "createdAt";

ALTER TABLE "LeadTimeline"
ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "occurredAt" SET NOT NULL;

ALTER TABLE "LeadTimeline"
ADD CONSTRAINT "LeadTimeline_actorId_fkey"
FOREIGN KEY ("actorId")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "LeadTimeline_leadId_occurredAt_idx"
ON "LeadTimeline"("leadId", "occurredAt");

CREATE INDEX "LeadTimeline_actorId_idx"
ON "LeadTimeline"("actorId");

COMMIT;

-- Rollback (only valid while no EMPLOYEE rows must be kept; it discards
-- employee attribution and activity types):
--
-- BEGIN;
-- DROP INDEX "LeadTimeline_actorId_idx";
-- DROP INDEX "LeadTimeline_leadId_occurredAt_idx";
-- ALTER TABLE "LeadTimeline" DROP CONSTRAINT "LeadTimeline_actorId_fkey";
-- ALTER TABLE "LeadTimeline"
--   DROP COLUMN "occurredAt",
--   DROP COLUMN "actorId",
--   DROP COLUMN "activityType",
--   DROP COLUMN "source";
-- DROP TYPE "LeadActivityType";
-- DROP TYPE "LeadTimelineSource";
-- COMMIT;
