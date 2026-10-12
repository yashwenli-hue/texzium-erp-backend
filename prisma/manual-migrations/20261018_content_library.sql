-- RevenueOS sales enablement: the content library.
--
-- Adds three tables:
--   "ContentAsset"  a catalogue (PDF), photo (JPEG, PNG, WebP) or video (MP4), with
--                   title, description, tags, an optional inventory item, and
--                   archive state;
--   "ContentFile"   an immutable version of an asset's file. The file itself lives
--                   in the content storage directory (outside the database and the
--                   repository) under a server-generated storageKey; the row keeps
--                   its type, size, sha256 and what metadata was removed;
--   "ContentShare"  a version shared with a lead, an opportunity or a customer
--                   (recorded together with the lead timeline or customer event).
-- Additive and idempotent: running it again changes nothing, and no existing table,
-- column or row is touched. Shares reference leads, opportunities and customers with
-- ON DELETE RESTRICT (a recorded share is customer contact and is kept; the deletion
-- policies refuse to delete a lead or customer that has one). Users referenced as
-- actors are ON DELETE SET NULL; an inventory item reference is ON DELETE SET NULL.
--
-- Permissions are a separate file: 20261018_content_library_permissions.sql.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261018_content_library.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "ContentAsset" (
  "id"              TEXT         NOT NULL,
  "title"           TEXT         NOT NULL,
  "description"     TEXT,
  "kind"            TEXT         NOT NULL,
  "tags"            TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "inventoryItemId" TEXT,
  "status"          TEXT         NOT NULL DEFAULT 'ACTIVE',
  "archivedAt"      TIMESTAMP(3),
  "archivedById"    TEXT,
  "archiveReason"   TEXT,
  "createdById"     TEXT,
  "updatedById"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentAsset_kind_check" CHECK ("kind" IN ('CATALOGUE', 'PHOTO', 'VIDEO')),
  CONSTRAINT "ContentAsset_status_check" CHECK (
    ("status" = 'ACTIVE' AND "archivedAt" IS NULL AND "archiveReason" IS NULL)
    OR ("status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL AND "archiveReason" IS NOT NULL)
  ),
  CONSTRAINT "ContentAsset_title_check" CHECK (length(btrim("title")) BETWEEN 1 AND 160)
);

CREATE INDEX IF NOT EXISTS "ContentAsset_status_kind_idx" ON "ContentAsset" ("status", "kind");
CREATE INDEX IF NOT EXISTS "ContentAsset_inventoryItemId_idx" ON "ContentAsset" ("inventoryItemId");

CREATE TABLE IF NOT EXISTS "ContentFile" (
  "id"              TEXT         NOT NULL,
  "assetId"         TEXT         NOT NULL,
  "version"         INTEGER      NOT NULL,
  "storageKey"      TEXT         NOT NULL,
  "originalName"    TEXT         NOT NULL,
  "mimeType"        TEXT         NOT NULL,
  "sizeBytes"       INTEGER      NOT NULL,
  "sha256"          TEXT         NOT NULL,
  "width"           INTEGER,
  "height"          INTEGER,
  "metadataRemoved" TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "uploadedById"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentFile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentFile_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ContentFile_size_check" CHECK ("sizeBytes" > 0),
  CONSTRAINT "ContentFile_mimeType_check" CHECK (
    "mimeType" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4')
  ),
  CONSTRAINT "ContentFile_storageKey_check" CHECK ("storageKey" ~ '^[0-9a-f]{2}/[0-9a-f-]{36}\.(pdf|jpg|png|webp|mp4)$'),
  CONSTRAINT "ContentFile_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentFile_storageKey_key" ON "ContentFile" ("storageKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ContentFile_assetId_version_key" ON "ContentFile" ("assetId", "version");

CREATE TABLE IF NOT EXISTS "ContentShare" (
  "id"             TEXT         NOT NULL,
  "assetId"        TEXT         NOT NULL,
  "fileId"         TEXT         NOT NULL,
  "version"        INTEGER      NOT NULL,
  "targetType"     TEXT         NOT NULL,
  "leadId"         TEXT,
  "opportunityId"  TEXT,
  "customerId"     TEXT,
  "channel"        TEXT         NOT NULL,
  "recipientName"  TEXT,
  "recipientPhone" TEXT,
  "message"        TEXT,
  "actorId"        TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContentShare_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentShare_channel_check" CHECK ("channel" IN ('WHATSAPP', 'DOWNLOAD')),
  CONSTRAINT "ContentShare_target_check" CHECK (
    ("targetType" = 'LEAD' AND "leadId" IS NOT NULL AND "opportunityId" IS NULL AND "customerId" IS NULL)
    OR ("targetType" = 'OPPORTUNITY' AND "opportunityId" IS NOT NULL AND "leadId" IS NOT NULL)
    OR ("targetType" = 'CUSTOMER' AND "customerId" IS NOT NULL AND "leadId" IS NULL AND "opportunityId" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "ContentShare_assetId_createdAt_idx" ON "ContentShare" ("assetId", "createdAt");
CREATE INDEX IF NOT EXISTS "ContentShare_leadId_idx" ON "ContentShare" ("leadId");
CREATE INDEX IF NOT EXISTS "ContentShare_opportunityId_idx" ON "ContentShare" ("opportunityId");
CREATE INDEX IF NOT EXISTS "ContentShare_customerId_idx" ON "ContentShare" ("customerId");

DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      ('ContentAsset', 'inventoryItemId', 'InventoryItem', 'SET NULL'),
      ('ContentAsset', 'archivedById',    'User',          'SET NULL'),
      ('ContentAsset', 'createdById',     'User',          'SET NULL'),
      ('ContentAsset', 'updatedById',     'User',          'SET NULL'),
      ('ContentFile',  'assetId',         'ContentAsset',  'RESTRICT'),
      ('ContentFile',  'uploadedById',    'User',          'SET NULL'),
      ('ContentShare', 'assetId',         'ContentAsset',  'RESTRICT'),
      ('ContentShare', 'fileId',          'ContentFile',   'RESTRICT'),
      ('ContentShare', 'leadId',          'Lead',          'RESTRICT'),
      ('ContentShare', 'opportunityId',   'Opportunity',   'RESTRICT'),
      ('ContentShare', 'customerId',      'Customer',      'RESTRICT'),
      ('ContentShare', 'actorId',         'User',          'SET NULL')
    ) AS v(tbl, col, ref, on_delete)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.tbl || '_' || fk.col || '_fkey') THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I ("id") ON DELETE %s ON UPDATE CASCADE',
        fk.tbl, fk.tbl || '_' || fk.col || '_fkey', fk.col, fk.ref, fk.on_delete
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;

-- Rollback (removes the library rows; the files in the content storage directory are
-- not touched and are removed, or restored from the content backup, separately). Only
-- before any share was recorded, or with the agreement that recorded shares are lost:
--
-- BEGIN;
-- DROP TABLE IF EXISTS "ContentShare";
-- DROP TABLE IF EXISTS "ContentFile";
-- DROP TABLE IF EXISTS "ContentAsset";
-- COMMIT;
