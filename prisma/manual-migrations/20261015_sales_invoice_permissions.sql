-- RevenueOS: permissions for sales invoices.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants them to SUPER_ADMIN only. The
-- Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   invoices.view     list sales invoices and download a tax-invoice document
--   invoices.create   issue a sales invoice (and add items to a legacy one)
--
-- Until this is applied, the new backend refuses every sales-invoice request
-- (403) because nobody holds these permissions: apply it before (or together
-- with) the backend that checks them. Permissions are copied into the login
-- token, so a signed-in user needs to log in again before they apply.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261015_sales_invoice_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('invoices.view',   'View Sales Invoices'),
  ('invoices.create', 'Issue Sales Invoices')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('invoices.view', 'invoices.create')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('invoices.view', 'invoices.create'));
-- DELETE FROM "Permission" WHERE "code" IN ('invoices.view', 'invoices.create');
-- COMMIT;
