-- RevenueOS: permissions for sales invoices.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants ONLY invoices.view to
-- SUPER_ADMIN. The Permission and RolePermission ids have no database default,
-- so they are generated here.
--
--   invoices.view     list sales invoices (granted to SUPER_ADMIN here)
--   invoices.create   issue a sales invoice (and add items to a legacy one):
--                     created here but NOT granted, so invoicing stays paused
--
-- Issuing an invoice takes a permanent statutory number (SI<state>/<FY>/<seq>),
-- so invoices.create is granted by a separate migration,
-- 20261017_sales_invoice_create_grant.sql, applied only once the invoice number
-- format has been approved. Until then every request to issue an invoice, or
-- to add an item to one, is refused (403).
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
JOIN "Permission" p ON p."code" = 'invoices.view'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the permissions and every grant of them, including one made
-- later by 20261017_sales_invoice_create_grant.sql):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('invoices.view', 'invoices.create'));
-- DELETE FROM "Permission" WHERE "code" IN ('invoices.view', 'invoices.create');
-- COMMIT;
