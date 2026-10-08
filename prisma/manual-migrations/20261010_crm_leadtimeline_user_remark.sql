-- CRM: a person's own remark on a lead-history event.
--
-- Additive and idempotent. One nullable column; no existing row is read, changed
-- or backfilled, so every row that exists now keeps userRemark NULL, and its
-- remarks, actorId, occurredAt and createdAt (and therefore the order of the
-- history) are untouched.
--
-- "LeadTimeline"."userRemark": what the person who performed an action wrote about
-- it. Today only OPPORTUNITY_STAGE_CHANGED fills it (the optional remark on a stage
-- move). It is kept apart from "remarks", which is the system's own sentence about
-- the event ('Opportunity "X": Qualified → Proposal').
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261010_crm_leadtimeline_user_remark.sql

BEGIN;

ALTER TABLE "LeadTimeline" ADD COLUMN IF NOT EXISTS "userRemark" TEXT;

COMMIT;

-- Rollback (removes the column; every remark entered since is lost, so copy them
-- first if they must be kept):
--
-- BEGIN;
-- ALTER TABLE "LeadTimeline" DROP COLUMN IF EXISTS "userRemark";
-- COMMIT;
--
--   CREATE TABLE "LeadTimelineUserRemark_backup" AS
--     SELECT "id", "userRemark" FROM "LeadTimeline" WHERE "userRemark" IS NOT NULL;
