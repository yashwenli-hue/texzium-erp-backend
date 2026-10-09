-- CRM: the tombstone table for governed data deletion and recovery.
--
-- Additive and idempotent: one new table, its indexes, and a lifecycle guard trigger.
-- No existing table, row or column is read, changed or backfilled; running it again
-- changes nothing.
--
-- "DataDeletionRecord" holds one row per record that was deleted through the governed
-- deletion path (a lead or a customer), written in the same transaction as the deletion.
-- It keeps a complete copy of what was removed (snapshot), what the deletion removed and
-- checked (impact), who did it, when, and why. entityId and survivorId are the ORIGINAL
-- ids of records that may no longer exist, so they are plain columns, not foreign keys;
-- the only foreign keys are to the people who acted (deleted, restored, purged).
--
-- Lifecycle. status is DELETED, then at most one of RESTORED (the record was put back) or
-- PURGED (erased for good). The end of the recovery window is stored, not calculated:
-- purgeAfter = deletedAt + the recovery policy at the time (30 days at first). The record is
-- recoverable while now <= purgeAfter (the deadline itself is still inside the window). A
-- PURGED row says HOW: purgeMethod MANUAL (an administrator, at any time, purgedById = who) or
-- AUTOMATIC (the purge worker, only strictly after purgeAfter, purgedById NULL: a system action).
--
-- Minimal retention after a purge (data minimisation). While a record is DELETED the tombstone
-- is a complete copy so that it can be restored. The moment it is PURGED everything that only
-- served recovery is erased, in the same UPDATE, and the database refuses a purge that keeps
-- any of it:
--   erased   snapshot (replaced by {"purged": true}), impact (replaced by {}), the free-text
--            reason, the record's name (entityLabel), its code (entityCode), the ORIGINAL id of
--            the lead or customer (entityId: once the record is gone nothing may point back to
--            it), the surviving record named for a duplicate (survivorId, survivorLabel), and
--            who deleted it (deletedById)
--   kept     id (the tombstone's own id: the audit lookup key), entityType, reasonCode (one of
--            five fixed categories, never free text, no personal data; it lets governance
--            report WHY records are purged: duplicates, test data, ...), deletedAt, purgeAfter
--            (the stored deadline: it is what shows an automatic purge came after the window),
--            status, purgedAt, purgeMethod, purgedById (manual only)
-- CHECKs keep each status consistent with its fields (a DELETED or RESTORED row always has its
-- name, reason and deleter; a PURGED row never has them) and make an automatic purge before
-- the deadline impossible even for a faulty worker. A trigger allows exactly the two
-- transitions DELETED -> RESTORED (nothing else changes) and DELETED -> PURGED (the identity
-- fields stay, everything listed as erased is erased); every other UPDATE, every DELETE and
-- every TRUNCATE is refused, so a purged entry can never be edited, reopened or removed.
-- (Reading a tombstone is guarded by governance.deletions.view.)
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261011_crm_data_deletion_record.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "DataDeletionRecord" (
  "id"            TEXT         NOT NULL,
  "entityType"    TEXT         NOT NULL,
  "entityId"      TEXT,
  "entityCode"    TEXT,
  "entityLabel"   TEXT,
  "reasonCode"    TEXT         NOT NULL,
  "reason"        TEXT,
  "survivorId"    TEXT,
  "survivorLabel" TEXT,
  "snapshot"      JSONB        NOT NULL,
  "impact"        JSONB        NOT NULL,
  "status"        TEXT         NOT NULL DEFAULT 'DELETED',
  "deletedById"   TEXT,
  "deletedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purgeAfter"    TIMESTAMP(3) NOT NULL,
  "restoredAt"    TIMESTAMP(3),
  "restoredById"  TEXT,
  "purgedAt"      TIMESTAMP(3),
  "purgedById"    TEXT,
  "purgeMethod"   TEXT,

  CONSTRAINT "DataDeletionRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataDeletionRecord_entityType_check"
    CHECK ("entityType" IN ('LEAD', 'CUSTOMER')),
  CONSTRAINT "DataDeletionRecord_reasonCode_check"
    CHECK ("reasonCode" IN ('DUPLICATE', 'ENTERED_IN_ERROR', 'TEST_DATA', 'JUNK_OR_SPAM', 'OTHER')),
  CONSTRAINT "DataDeletionRecord_reason_check"
    CHECK ("reason" IS NULL OR char_length(btrim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "DataDeletionRecord_survivor_check"
    CHECK (
      ("survivorId" IS NULL AND "survivorLabel" IS NULL)
      OR ("survivorId" IS NOT NULL AND "survivorLabel" IS NOT NULL
          AND "reasonCode" = 'DUPLICATE' AND "survivorId" <> "entityId")
    ),
  CONSTRAINT "DataDeletionRecord_status_check"
    CHECK ("status" IN ('DELETED', 'RESTORED', 'PURGED')),
  CONSTRAINT "DataDeletionRecord_lifecycle_check"
    CHECK (
      ("status" = 'DELETED'
        AND "entityId" IS NOT NULL AND "entityLabel" IS NOT NULL AND "reason" IS NOT NULL AND "deletedById" IS NOT NULL
        AND "restoredAt" IS NULL AND "restoredById" IS NULL
        AND "purgedAt" IS NULL AND "purgedById" IS NULL AND "purgeMethod" IS NULL)
      OR ("status" = 'RESTORED'
        AND "entityId" IS NOT NULL AND "entityLabel" IS NOT NULL AND "reason" IS NOT NULL AND "deletedById" IS NOT NULL
        AND "restoredAt" IS NOT NULL AND "restoredById" IS NOT NULL
        AND "purgedAt" IS NULL AND "purgedById" IS NULL AND "purgeMethod" IS NULL)
      OR ("status" = 'PURGED'
        AND "purgedAt" IS NOT NULL AND "purgeMethod" IS NOT NULL
        AND "restoredAt" IS NULL AND "restoredById" IS NULL
        AND "entityId" IS NULL AND "entityCode" IS NULL AND "entityLabel" IS NULL AND "reason" IS NULL
        AND "survivorId" IS NULL AND "survivorLabel" IS NULL AND "deletedById" IS NULL
        AND "impact" = '{}'::jsonb AND "snapshot" = '{"purged": true}'::jsonb
        AND (
          ("purgeMethod" = 'MANUAL' AND "purgedById" IS NOT NULL)
          OR ("purgeMethod" = 'AUTOMATIC' AND "purgedById" IS NULL AND "purgedAt" > "purgeAfter")
        ))
    ),
  CONSTRAINT "DataDeletionRecord_purgedAt_check"
    CHECK ("purgedAt" IS NULL OR "purgedAt" >= "deletedAt"),
  CONSTRAINT "DataDeletionRecord_purgeAfter_check"
    CHECK ("purgeAfter" >= "deletedAt"),
  CONSTRAINT "DataDeletionRecord_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DataDeletionRecord_restoredById_fkey"
    FOREIGN KEY ("restoredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DataDeletionRecord_purgedById_fkey"
    FOREIGN KEY ("purgedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DataDeletionRecord_entityType_entityId_idx" ON "DataDeletionRecord"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "DataDeletionRecord_status_deletedAt_idx"    ON "DataDeletionRecord"("status", "deletedAt");
CREATE INDEX IF NOT EXISTS "DataDeletionRecord_deletedAt_idx"           ON "DataDeletionRecord"("deletedAt");
CREATE INDEX IF NOT EXISTS "DataDeletionRecord_deletedById_idx"         ON "DataDeletionRecord"("deletedById");
CREATE INDEX IF NOT EXISTS "DataDeletionRecord_restoredById_idx"        ON "DataDeletionRecord"("restoredById");
CREATE INDEX IF NOT EXISTS "DataDeletionRecord_purgedById_idx"          ON "DataDeletionRecord"("purgedById");

-- The lifecycle guard. A tombstone is only ever finished, never edited: from DELETED it may
-- move to RESTORED (every other column unchanged) or to PURGED (the identity and timing fields
-- unchanged, and all personal and recovery-only data, the original record id included,
-- erased in the same statement). Nothing
-- else is allowed: a PURGED or RESTORED row cannot be changed at all, and no row can be deleted
-- or truncated.
CREATE OR REPLACE FUNCTION "DataDeletionRecord_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" = 'DELETED'
     AND NEW."status" IN ('RESTORED', 'PURGED')
     AND NEW."id"            IS NOT DISTINCT FROM OLD."id"
     AND NEW."entityType"    IS NOT DISTINCT FROM OLD."entityType"
     AND NEW."reasonCode"    IS NOT DISTINCT FROM OLD."reasonCode"
     AND NEW."deletedAt"     IS NOT DISTINCT FROM OLD."deletedAt"
     AND NEW."purgeAfter"    IS NOT DISTINCT FROM OLD."purgeAfter"
     AND (
       (NEW."status" = 'RESTORED'
         AND NEW."entityId"      IS NOT DISTINCT FROM OLD."entityId"
         AND NEW."entityCode"    IS NOT DISTINCT FROM OLD."entityCode"
         AND NEW."entityLabel"   IS NOT DISTINCT FROM OLD."entityLabel"
         AND NEW."reason"        IS NOT DISTINCT FROM OLD."reason"
         AND NEW."survivorId"    IS NOT DISTINCT FROM OLD."survivorId"
         AND NEW."survivorLabel" IS NOT DISTINCT FROM OLD."survivorLabel"
         AND NEW."impact"        IS NOT DISTINCT FROM OLD."impact"
         AND NEW."deletedById"   IS NOT DISTINCT FROM OLD."deletedById"
         AND NEW."snapshot"      IS NOT DISTINCT FROM OLD."snapshot")
       OR (NEW."status" = 'PURGED'
         AND NEW."entityId"      IS NULL
         AND NEW."entityCode"    IS NULL
         AND NEW."entityLabel"   IS NULL
         AND NEW."reason"        IS NULL
         AND NEW."survivorId"    IS NULL
         AND NEW."survivorLabel" IS NULL
         AND NEW."deletedById"   IS NULL
         AND NEW."impact"        = '{}'::jsonb
         AND NEW."snapshot"      = '{"purged": true}'::jsonb)
     )
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'DataDeletionRecord is append-only: a tombstone can only move from DELETED to RESTORED, or to PURGED with its personal data erased, and cannot otherwise be changed or removed'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "DataDeletionRecord_no_change" ON "DataDeletionRecord";
CREATE TRIGGER "DataDeletionRecord_no_change"
  BEFORE UPDATE OR DELETE ON "DataDeletionRecord"
  FOR EACH ROW EXECUTE FUNCTION "DataDeletionRecord_guard"();

DROP TRIGGER IF EXISTS "DataDeletionRecord_no_truncate" ON "DataDeletionRecord";
CREATE TRIGGER "DataDeletionRecord_no_truncate"
  BEFORE TRUNCATE ON "DataDeletionRecord"
  FOR EACH STATEMENT EXECUTE FUNCTION "DataDeletionRecord_guard"();

COMMIT;

-- Rollback (drops the table and every tombstone in it, so copy the rows first if they
-- must be kept; a lead or customer that is still in the recycle bin can only be put back
-- from that copy):
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS "DataDeletionRecord_no_change"   ON "DataDeletionRecord";
-- DROP TRIGGER IF EXISTS "DataDeletionRecord_no_truncate" ON "DataDeletionRecord";
-- DROP TABLE IF EXISTS "DataDeletionRecord";
-- DROP FUNCTION IF EXISTS "DataDeletionRecord_guard"();
-- COMMIT;
--
--   CREATE TABLE "DataDeletionRecord_backup" AS TABLE "DataDeletionRecord";   -- before the DROP
