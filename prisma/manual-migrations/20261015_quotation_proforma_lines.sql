-- RevenueOS: priced lines on quotations and Proforma Invoices; unique numbers.
--
-- Additive and idempotent. No existing row is changed and nothing is
-- back-filled: quotations and Proforma Invoices created before this change
-- have no lines (their quantity, unit rate and item were never stored, so none
-- are made up) and keep their existing numbers (today: none). Before anything
-- is created the script checks that existing numbers are unique and stops,
-- changing nothing, if they are not.
--
-- 1. "QuotationLine": one row per priced line of a quotation (item, copied
--    description and HSN, quantity, unit rate, taxable amount, GST rate, CGST /
--    SGST / IGST, GST and total), all worked out by the backend.
-- 2. "ProformaInvoiceLine": a copy of the Quotation's lines taken when the
--    Proforma is created ("sourceQuotationLineId" names the line copied).
-- 3. "Quotation"."quotationCode" and "ProformaInvoice"."proformaNumber" are
--    unique when present (numbers come from DocumentNumberCounter).
--
-- Amounts are DOUBLE PRECISION like every other amount in this schema, rounded
-- to the paisa by the application.
--
-- Apply (after 20261015_document_number_counter.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261015_quotation_proforma_lines.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Quotation" WHERE "quotationCode" IS NOT NULL
    GROUP BY "quotationCode" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot require unique quotation numbers: two quotations share a number.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "ProformaInvoice" WHERE "proformaNumber" IS NOT NULL
    GROUP BY "proformaNumber" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot require unique Proforma numbers: two Proforma Invoices share a number.';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "Quotation_quotationCode_key"
  ON "Quotation" ("quotationCode");

CREATE UNIQUE INDEX IF NOT EXISTS "ProformaInvoice_proformaNumber_key"
  ON "ProformaInvoice" ("proformaNumber");

CREATE TABLE IF NOT EXISTS "QuotationLine" (
  "id"              TEXT             NOT NULL,
  "quotationId"     TEXT             NOT NULL,
  "lineNumber"      INTEGER          NOT NULL,
  "inventoryItemId" TEXT,
  "description"     TEXT             NOT NULL,
  "hsnCode"         TEXT,
  "quantity"        DOUBLE PRECISION NOT NULL,
  "unitRate"        DOUBLE PRECISION NOT NULL,
  "taxableAmount"   DOUBLE PRECISION NOT NULL,
  "gstRate"         DOUBLE PRECISION NOT NULL,
  "cgstAmount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sgstAmount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "igstAmount"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gstAmount"       DOUBLE PRECISION NOT NULL,
  "totalAmount"     DOUBLE PRECISION NOT NULL,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuotationLine_lineNumber_check" CHECK ("lineNumber" >= 1),
  CONSTRAINT "QuotationLine_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "QuotationLine_unitRate_check" CHECK ("unitRate" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "QuotationLine_quotationId_lineNumber_key"
  ON "QuotationLine" ("quotationId", "lineNumber");

CREATE TABLE IF NOT EXISTS "ProformaInvoiceLine" (
  "id"                    TEXT             NOT NULL,
  "proformaInvoiceId"     TEXT             NOT NULL,
  "sourceQuotationLineId" TEXT,
  "lineNumber"            INTEGER          NOT NULL,
  "inventoryItemId"       TEXT,
  "description"           TEXT             NOT NULL,
  "hsnCode"               TEXT,
  "quantity"              DOUBLE PRECISION NOT NULL,
  "unitRate"              DOUBLE PRECISION NOT NULL,
  "taxableAmount"         DOUBLE PRECISION NOT NULL,
  "gstRate"               DOUBLE PRECISION NOT NULL,
  "cgstAmount"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sgstAmount"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "igstAmount"            DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gstAmount"             DOUBLE PRECISION NOT NULL,
  "totalAmount"           DOUBLE PRECISION NOT NULL,
  "createdAt"             TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProformaInvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProformaInvoiceLine_lineNumber_check" CHECK ("lineNumber" >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProformaInvoiceLine_proformaInvoiceId_lineNumber_key"
  ON "ProformaInvoiceLine" ("proformaInvoiceId", "lineNumber");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuotationLine_quotationId_fkey') THEN
    ALTER TABLE "QuotationLine"
      ADD CONSTRAINT "QuotationLine_quotationId_fkey"
      FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProformaInvoiceLine_proformaInvoiceId_fkey') THEN
    ALTER TABLE "ProformaInvoiceLine"
      ADD CONSTRAINT "ProformaInvoiceLine_proformaInvoiceId_fkey"
      FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the lines and the unique indexes; the quotations,
-- Proforma Invoices and their numbers stay):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "ProformaInvoiceLine";
-- DROP TABLE IF EXISTS "QuotationLine";
-- DROP INDEX IF EXISTS "ProformaInvoice_proformaNumber_key";
-- DROP INDEX IF EXISTS "Quotation_quotationCode_key";
-- COMMIT;
--
-- Lines are not recorded anywhere else. Copy them first if they must be kept:
--   CREATE TABLE "QuotationLine_backup" AS SELECT * FROM "QuotationLine";
--   CREATE TABLE "ProformaInvoiceLine_backup" AS SELECT * FROM "ProformaInvoiceLine";
