-- CRM: Proforma Invoice lifecycle history.
--
-- Adds the "ProformaEvent" table. Additive and idempotent: running it again
-- changes nothing, and no existing table, column or row is touched (the
-- ProformaInvoice and User tables only gain a relation in the Prisma schema,
-- not a column).
--
-- One row per lifecycle event of a Proforma Invoice: what happened ("action"),
-- the status before and after, optional remarks (the reason, for a
-- cancellation), and who did it ("actorId", always the signed-in user). The
-- actor foreign key is ON DELETE SET NULL so history survives a deleted
-- account.
--
-- No history is back-filled: Proformas that exist today simply have no events
-- until their next lifecycle action.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261007_crm_proforma_event.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "ProformaEvent" (
  "id"                TEXT         NOT NULL,
  "proformaInvoiceId" TEXT         NOT NULL,
  "action"            TEXT         NOT NULL,
  "fromStatus"        TEXT,
  "toStatus"          TEXT,
  "remarks"           TEXT,
  "actorId"           TEXT,
  "occurredAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProformaEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProformaEvent_proformaInvoiceId_occurredAt_idx"
  ON "ProformaEvent" ("proformaInvoiceId", "occurredAt");

CREATE INDEX IF NOT EXISTS "ProformaEvent_actorId_idx"
  ON "ProformaEvent" ("actorId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProformaEvent_proformaInvoiceId_fkey'
  ) THEN
    ALTER TABLE "ProformaEvent"
      ADD CONSTRAINT "ProformaEvent_proformaInvoiceId_fkey"
      FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProformaEvent_actorId_fkey'
  ) THEN
    ALTER TABLE "ProformaEvent"
      ADD CONSTRAINT "ProformaEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the table and every event in it):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "ProformaEvent";
-- COMMIT;
--
-- Events are history that is not recorded anywhere else. Copy them first if
-- they must be kept:
--   CREATE TABLE "ProformaEvent_backup" AS SELECT * FROM "ProformaEvent";
