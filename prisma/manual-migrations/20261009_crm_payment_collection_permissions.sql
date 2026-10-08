-- CRM: permissions for payment collections.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants them to SUPER_ADMIN only. The
-- Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   collections.view     list and read payment collections and a receivable's
--                        collection history
--   collections.record   record a payment against a receivable
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permissions apply to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261009_crm_payment_collection_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('collections.view',   'View Payment Collections'),
  ('collections.record', 'Record Payment Collections')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('collections.view', 'collections.record')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('collections.view', 'collections.record'));
-- DELETE FROM "Permission" WHERE "code" IN ('collections.view', 'collections.record');
-- COMMIT;
