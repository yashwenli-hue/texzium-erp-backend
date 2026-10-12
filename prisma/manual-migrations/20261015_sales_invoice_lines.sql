-- RevenueOS: invoice lines with tax detail; unique invoice numbers.
--
-- Additive and idempotent. No existing row is changed: invoices issued before
-- this change keep no number (today all of them) and their items keep the new
-- columns empty. Before anything is created the script checks that existing
-- invoice numbers are unique and stops, changing nothing, if they are not.
--
-- 1. "SalesInvoiceItem" gains the line's number, description, HSN, GST rate and
--    CGST/SGST/IGST amounts, and "sourceLineId" (the Proforma or Quotation line
--    it was copied from). All nullable: older items have none.
-- 2. "SalesInvoice"."invoiceNumber" is unique when present (numbers come from
--    DocumentNumberCounter: SI<state>/<FY>/<sequence>).
--
-- Permissions are a separate file: 20261015_sales_invoice_permissions.sql.
--
-- Apply (after 20261015_document_number_counter.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261015_sales_invoice_lines.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "SalesInvoice" WHERE "invoiceNumber" IS NOT NULL
    GROUP BY "invoiceNumber" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot require unique invoice numbers: two invoices share a number.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "SalesInvoice_invoiceNumber_key"
  ON "SalesInvoice" ("invoiceNumber");

ALTER TABLE "SalesInvoiceItem"
  ADD COLUMN IF NOT EXISTS "lineNumber"   INTEGER,
  ADD COLUMN IF NOT EXISTS "description"  TEXT,
  ADD COLUMN IF NOT EXISTS "hsnCode"      TEXT,
  ADD COLUMN IF NOT EXISTS "gstRate"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "cgstAmount"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "sgstAmount"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "igstAmount"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "sourceLineId" TEXT;

COMMIT;

-- Rollback (removes the new columns and the index; invoices and their numbers
-- stay; the copied line detail is lost):
--
-- BEGIN;
-- ALTER TABLE "SalesInvoiceItem"
--   DROP COLUMN IF EXISTS "lineNumber", DROP COLUMN IF EXISTS "description",
--   DROP COLUMN IF EXISTS "hsnCode", DROP COLUMN IF EXISTS "gstRate",
--   DROP COLUMN IF EXISTS "cgstAmount", DROP COLUMN IF EXISTS "sgstAmount",
--   DROP COLUMN IF EXISTS "igstAmount", DROP COLUMN IF EXISTS "sourceLineId";
-- DROP INDEX IF EXISTS "SalesInvoice_invoiceNumber_key";
-- COMMIT;
