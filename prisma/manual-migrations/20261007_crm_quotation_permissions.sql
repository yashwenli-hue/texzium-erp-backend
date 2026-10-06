-- CRM: permissions for the Quotation lifecycle.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants every one to SUPER_ADMIN only.
-- The Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   quotations.view        view Quotations and their history
--   quotations.create      create a Quotation
--   quotations.edit        revise a Quotation
--   quotations.approve     approve a Quotation
--   quotations.reject      reject a Quotation
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permissions apply to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261007_crm_quotation_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('quotations.view',    'View Quotations'),
  ('quotations.create',  'Create Quotations'),
  ('quotations.edit',    'Revise Quotations'),
  ('quotations.approve', 'Approve Quotations'),
  ('quotations.reject',  'Reject Quotations')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN (
  'quotations.view',
  'quotations.create',
  'quotations.edit',
  'quotations.approve',
  'quotations.reject'
)
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the five permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--   WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN (
--     'quotations.view',
--     'quotations.create',
--     'quotations.edit',
--     'quotations.approve',
--     'quotations.reject'));
-- DELETE FROM "Permission" WHERE "code" IN (
--   'quotations.view',
--   'quotations.create',
--   'quotations.edit',
--   'quotations.approve',
--   'quotations.reject');
-- COMMIT;
