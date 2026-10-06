-- CRM: permissions for the Proforma Invoice lifecycle.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants every one to SUPER_ADMIN only.
-- The Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   proformas.view        view Proforma Invoices and their history
--   proformas.create      create a Proforma Invoice
--   proformas.approve     approve a Proforma Invoice
--   proformas.cancel      cancel a Proforma Invoice
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permissions apply to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261007_crm_proforma_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('proformas.view',    'View Proforma Invoices'),
  ('proformas.create',  'Create Proforma Invoices'),
  ('proformas.approve', 'Approve Proforma Invoices'),
  ('proformas.cancel',  'Cancel Proforma Invoices')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN (
  'proformas.view',
  'proformas.create',
  'proformas.approve',
  'proformas.cancel'
)
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the four permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--   WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN (
--     'proformas.view',
--     'proformas.create',
--     'proformas.approve',
--     'proformas.cancel'));
-- DELETE FROM "Permission" WHERE "code" IN (
--   'proformas.view',
--   'proformas.create',
--   'proformas.approve',
--   'proformas.cancel');
-- COMMIT;
