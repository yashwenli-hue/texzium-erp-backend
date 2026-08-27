BEGIN;

CREATE TYPE "LeadFollowupStatus" AS ENUM (
  'PENDING',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "LeadFollowup"
ADD COLUMN "status" "LeadFollowupStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "completedById" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "LeadFollowup"
ADD CONSTRAINT "LeadFollowup_completedById_fkey"
FOREIGN KEY ("completedById")
REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "LeadFollowup_leadId_idx"
ON "LeadFollowup"("leadId");

CREATE INDEX "LeadFollowup_status_idx"
ON "LeadFollowup"("status");

CREATE INDEX "LeadFollowup_followupDate_idx"
ON "LeadFollowup"("followupDate");

CREATE INDEX "LeadFollowup_completedById_idx"
ON "LeadFollowup"("completedById");

COMMIT;
