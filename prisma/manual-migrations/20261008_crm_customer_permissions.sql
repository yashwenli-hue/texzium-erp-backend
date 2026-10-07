-- CRM: permissions for Customer management.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants every one to SUPER_ADMIN only.
-- The Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   customers.view         view Customers, their GST registrations and history
--   customers.create       create a Customer
--   customers.edit         edit a Customer
--   customers.deactivate   deactivate and reactivate a Customer
--
-- The permission for managing GST registrations is added with the checkpoint
-- that governs them.
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permissions apply to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261008_crm_customer_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('customers.view',       'View Customers'),
  ('customers.create',     'Create Customers'),
  ('customers.edit',       'Edit Customers'),
  ('customers.deactivate', 'Deactivate Customers')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN (
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.deactivate'
)
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the four permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--   WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN (
--     'customers.view',
--     'customers.create',
--     'customers.edit',
--     'customers.deactivate'));
-- DELETE FROM "Permission" WHERE "code" IN (
--   'customers.view',
--   'customers.create',
--   'customers.edit',
--   'customers.deactivate');
-- COMMIT;
