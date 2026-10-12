-- Documents: what the company prints on its business documents.
--
-- Adds the "CompanyDocumentProfile" table (one row per company: registered
-- office, logo, bank details, terms per document type, authorised signatory).
-- Additive and idempotent: running it again changes nothing, and no existing
-- table, column or row is touched. No profile is created: until someone fills
-- it in, documents print the company master and GST registration details only.
--
-- The logo is stored in the row (PNG or JPEG, at most 64 KB, checked by the
-- application and by the constraint below). "updatedById" is the last user to change the profile (ON
-- DELETE SET NULL).
--
-- Permissions are a separate file: 20261015_company_document_profile_permissions.sql.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261015_company_document_profile.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "CompanyDocumentProfile" (
  "id"                      TEXT         NOT NULL,
  "companyId"               TEXT         NOT NULL,
  "registeredOfficeAddress" TEXT,
  "logoData"                BYTEA,
  "logoMimeType"            TEXT,
  "bankAccountName"         TEXT,
  "bankName"                TEXT,
  "bankAccountNumber"       TEXT,
  "bankIfsc"                TEXT,
  "bankBranch"              TEXT,
  "upiId"                   TEXT,
  "quotationTerms"          TEXT,
  "proformaTerms"           TEXT,
  "invoiceTerms"            TEXT,
  "receiptNote"             TEXT,
  "signatoryName"           TEXT,
  "signatoryDesignation"    TEXT,
  "updatedById"             TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompanyDocumentProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyDocumentProfile_logo_check" CHECK (
    ("logoData" IS NULL AND "logoMimeType" IS NULL)
    OR ("logoData" IS NOT NULL AND "logoMimeType" IN ('image/png', 'image/jpeg')
        AND octet_length("logoData") <= 65536)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "CompanyDocumentProfile_companyId_key"
  ON "CompanyDocumentProfile" ("companyId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyDocumentProfile_companyId_fkey') THEN
    ALTER TABLE "CompanyDocumentProfile"
      ADD CONSTRAINT "CompanyDocumentProfile_companyId_fkey"
      FOREIGN KEY ("companyId") REFERENCES "Company" ("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CompanyDocumentProfile_updatedById_fkey') THEN
    ALTER TABLE "CompanyDocumentProfile"
      ADD CONSTRAINT "CompanyDocumentProfile_updatedById_fkey"
      FOREIGN KEY ("updatedById") REFERENCES "User" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

COMMIT;

-- Rollback (removes the profile and everything in it, including the logo):
--
-- BEGIN;
-- DROP TABLE IF EXISTS "CompanyDocumentProfile";
-- COMMIT;
