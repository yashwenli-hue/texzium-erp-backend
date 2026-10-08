-- CRM: permissions for governed data deletion.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants them to SUPER_ADMIN only. The
-- Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   leads.delete               preview and permanently delete a lead
--   customers.delete           preview and permanently delete a customer
--   governance.deletions.view  read the deletion log (the tombstones, with their
--                              full snapshots)
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permissions apply to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261011_crm_data_deletion_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('leads.delete',              'Delete Leads'),
  ('customers.delete',          'Delete Customers'),
  ('governance.deletions.view', 'View Data Deletion Log')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('leads.delete', 'customers.delete', 'governance.deletions.view')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('leads.delete', 'customers.delete', 'governance.deletions.view'));
-- DELETE FROM "Permission" WHERE "code" IN ('leads.delete', 'customers.delete', 'governance.deletions.view');
-- COMMIT;
