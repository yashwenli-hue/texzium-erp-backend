-- CRM: Sales Order lifecycle history.
--
-- Adds the "SalesOrderEvent" table. Additive and idempotent: running it again
-- changes nothing, and no existing table, column or row is touched (the
-- SalesOrder and User tables only gain a relation in the Prisma schema, not a
-- column).
--
-- One row per lifecycle event of a Sales Order: what happened ("action"), the
-- outcome ("result"), the order's status before and after, the advance receipt
-- or approval it is about ("referenceId"), optional remarks, and who did it
-- ("actorId", always the signed-in user). The actor foreign key is
-- ON DELETE SET NULL so history survives a deleted account.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261006_crm_sales_order_event.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "SalesOrderEvent" (
  "id"           TEXT         NOT NULL,
  "salesOrderId" TEXT         NOT NULL,
  "action"       TEXT         NOT NULL,
  "result"       TEXT,
  "fromStatus"   TEXT,
  "toStatus"     TEXT,
  "referenceId"  TEXT,
  "remarks"      TEXT,
  "actorId"      TEXT,
  "occurredAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalesOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SalesOrderEvent_salesOrderId_occurredAt_idx"
  ON "SalesOrderEvent" ("salesOrderId", "occurredAt");

CREATE INDEX IF NOT EXISTS "SalesOrderEvent_actorId_idx"
  ON "SalesOrderEvent" ("actorId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SalesOrderEvent_salesOrderId_fkey'
  ) THEN
    ALTER TABLE "SalesOrderEvent"
      ADD CONSTRAINT "SalesOrderEvent_salesOrderId_fkey"
      FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SalesOrderEvent_actorId_fkey'
  ) THEN
    ALTER TABLE "SalesOrderEvent"
      ADD CONSTRAINT "SalesOrderEvent_actorId_fkey"
      FOREIGN KEY ("actorId") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the table and every event in it):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "SalesOrderEvent";
-- COMMIT;
--
-- Events are history that is not recorded anywhere else. Copy them first if
-- they must be kept:
--   CREATE TABLE "SalesOrderEvent_backup" AS SELECT * FROM "SalesOrderEvent";
