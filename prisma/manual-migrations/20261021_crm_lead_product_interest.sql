-- CRM: the product or machine an enquiry is about.
--
-- Additive and idempotent. Adds one nullable column to "Lead", pointing at an existing
-- "InventoryItem" (nothing is added to the catalogue, nothing is inferred for existing
-- leads: they keep NULL, "not recorded"). Deleting an inventory item clears the reference
-- (ON DELETE SET NULL); the lead and its history stay.
--
-- Used to tell a returning person's NEW enquiry about another product apart from an
-- accidental duplicate of the same enquiry. Each enquiry keeps its own product: a later
-- enquiry from the same person never changes an earlier one.
--
-- The 8d2b5ed backend ignores the column (rehearsed), so a code-only rollback is safe.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261021_crm_lead_product_interest.sql

BEGIN;

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "inventoryItemId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Lead_inventoryItemId_fkey') THEN
    ALTER TABLE "Lead"
      ADD CONSTRAINT "Lead_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId")
      REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Lead_inventoryItemId_idx" ON "Lead"("inventoryItemId");

COMMIT;

-- Rollback (after the code rollback; drops what was recorded in the column):
-- BEGIN;
-- ALTER TABLE "Lead" DROP CONSTRAINT IF EXISTS "Lead_inventoryItemId_fkey";
-- DROP INDEX IF EXISTS "Lead_inventoryItemId_idx";
-- ALTER TABLE "Lead" DROP COLUMN IF EXISTS "inventoryItemId";
-- COMMIT;
