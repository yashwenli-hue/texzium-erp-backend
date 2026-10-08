-- CRM: the tombstone table for governed data deletion.
--
-- Additive and idempotent: one new table, its indexes, and an append-only trigger.
-- No existing table, row or column is read, changed or backfilled; running it again
-- changes nothing.
--
-- "DataDeletionRecord" holds one row per record that was permanently deleted through
-- the governed deletion path, written in the same transaction as the deletion. It
-- keeps a complete copy of what was removed (snapshot), what the deletion removed and
-- checked (impact), who did it, when, and why. entityId and survivorId are the ORIGINAL
-- ids of records that no longer exist, so they are plain columns, not foreign keys; the
-- only foreign key is to the person who deleted.
--
-- The shape is checked here as well as in the application: a known entity type and
-- reason code, a reason of 1 to 500 characters, and a surviving record only for a
-- DUPLICATE and never the record itself. A trigger refuses every UPDATE, DELETE and
-- TRUNCATE: a tombstone, once written, is permanent. (The snapshot is the full record,
-- personal data included; reading it is guarded by governance.deletions.view. There is
-- deliberately no purge or redaction: retention is an open policy decision.)
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261011_crm_data_deletion_record.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "DataDeletionRecord" (
  "id"            TEXT         NOT NULL,
  "entityType"    TEXT         NOT NULL,
  "entityId"      TEXT         NOT NULL,
  "entityCode"    TEXT,
  "entityLabel"   TEXT         NOT NULL,
  "reasonCode"    TEXT         NOT NULL,
  "reason"        TEXT         NOT NULL,
  "survivorId"    TEXT,
  "survivorLabel" TEXT,
  "snapshot"      JSONB        NOT NULL,
  "impact"        JSONB        NOT NULL,
  "deletedById"   TEXT         NOT NULL,
  "deletedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DataDeletionRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataDeletionRecord_entityType_check"
    CHECK ("entityType" IN ('LEAD', 'CUSTOMER')),
  CONSTRAINT "DataDeletionRecord_reasonCode_check"
    CHECK ("reasonCode" IN ('DUPLICATE', 'ENTERED_IN_ERROR', 'TEST_DATA', 'JUNK_OR_SPAM', 'OTHER')),
  CONSTRAINT "DataDeletionRecord_reason_check"
    CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500),
  CONSTRAINT "DataDeletionRecord_survivor_check"
    CHECK (
      ("survivorId" IS NULL AND "survivorLabel" IS NULL)
      OR ("survivorId" IS NOT NULL AND "survivorLabel" IS NOT NULL
          AND "reasonCode" = 'DUPLICATE' AND "survivorId" <> "entityId")
    ),
  CONSTRAINT "DataDeletionRecord_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "DataDeletionRecord_entityType_entityId_idx" ON "DataDeletionRecord"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "DataDeletionRecord_deletedAt_idx"           ON "DataDeletionRecord"("deletedAt");
CREATE INDEX IF NOT EXISTS "DataDeletionRecord_deletedById_idx"         ON "DataDeletionRecord"("deletedById");

CREATE OR REPLACE FUNCTION "DataDeletionRecord_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DataDeletionRecord is append-only: a tombstone cannot be changed or removed'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "DataDeletionRecord_no_change" ON "DataDeletionRecord";
CREATE TRIGGER "DataDeletionRecord_no_change"
  BEFORE UPDATE OR DELETE ON "DataDeletionRecord"
  FOR EACH ROW EXECUTE FUNCTION "DataDeletionRecord_append_only"();

DROP TRIGGER IF EXISTS "DataDeletionRecord_no_truncate" ON "DataDeletionRecord";
CREATE TRIGGER "DataDeletionRecord_no_truncate"
  BEFORE TRUNCATE ON "DataDeletionRecord"
  FOR EACH STATEMENT EXECUTE FUNCTION "DataDeletionRecord_append_only"();

COMMIT;

-- Rollback (drops the table and every tombstone in it, so copy the rows first if they
-- must be kept):
--
-- BEGIN;
-- DROP TRIGGER IF EXISTS "DataDeletionRecord_no_change"   ON "DataDeletionRecord";
-- DROP TRIGGER IF EXISTS "DataDeletionRecord_no_truncate" ON "DataDeletionRecord";
-- DROP TABLE IF EXISTS "DataDeletionRecord";
-- DROP FUNCTION IF EXISTS "DataDeletionRecord_append_only"();
-- COMMIT;
--
--   CREATE TABLE "DataDeletionRecord_backup" AS TABLE "DataDeletionRecord";   -- before the DROP
