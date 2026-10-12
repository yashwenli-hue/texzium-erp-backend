-- RevenueOS: the permission to print a tax invoice, granted to nobody.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission code below and DOES NOT GRANT IT TO ANY ROLE. The
-- tax-invoice PDF (GET /sales-invoices/:id/document.pdf) needs invoices.view
-- and this permission, so until it is granted nobody can print a tax invoice.
-- It stays ungranted until the accountant has confirmed whether e-invoicing
-- applies (if it does, a real IRN/QR from the Invoice Registration Portal is
-- needed first) and settled signature, copy labels and delivery address.
--
--   invoices.document.view   download a sales invoice as a tax-invoice PDF
--
-- The script also checks, and stops if it finds, that no role holds the
-- permission (a grant must be a separate, deliberate change).
--
-- Apply (after 20261015_sales_invoice_permissions.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261016_tax_invoice_document_permission.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, 'invoices.document.view', 'Print Tax Invoices', 'RevenueOS'
ON CONFLICT ("code") DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "RolePermission" rp
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE p."code" = 'invoices.document.view'
  ) THEN
    RAISE EXCEPTION 'invoices.document.view is already granted to a role; this migration only creates it ungranted.';
  END IF;
END
$$;

COMMIT;

-- Granting it later (a separate, approved change, after the accountant's
-- answer), for example to SUPER_ADMIN:
--
-- INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
-- SELECT gen_random_uuid()::text, r."id", p."id"
-- FROM "Role" r JOIN "Permission" p ON p."code" = 'invoices.document.view'
-- WHERE r."name" = 'SUPER_ADMIN'
-- ON CONFLICT ("roleId", "permissionId") DO NOTHING;
--
-- Rollback (removes any grant and the permission):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'invoices.document.view');
-- DELETE FROM "Permission" WHERE "code" = 'invoices.document.view';
-- COMMIT;
