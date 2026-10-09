-- CRM: permissions for governed data deletion.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants them to SUPER_ADMIN only. The
-- Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   leads.delete                  preview and delete a lead (it goes to the recycle bin)
--   customers.delete              preview and delete a customer (same)
--   governance.deletions.view     read the deletion log / recycle bin (the tombstones,
--                                 with their full snapshots)
--   governance.deletions.restore  preview and perform a restore from the recycle bin
--   governance.deletions.purge    erase a record's saved copy for good, at any time (the
--                                 tombstone keeps only a minimal audit entry); records nobody
--                                 restores are also erased automatically after 30 days
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
  ('leads.delete',                  'Delete Leads'),
  ('customers.delete',              'Delete Customers'),
  ('governance.deletions.view',     'View Data Deletion Log'),
  ('governance.deletions.restore',  'Restore Deleted Records'),
  ('governance.deletions.purge',    'Purge Deleted Records')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('leads.delete', 'customers.delete', 'governance.deletions.view', 'governance.deletions.restore', 'governance.deletions.purge')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('leads.delete', 'customers.delete', 'governance.deletions.view', 'governance.deletions.restore', 'governance.deletions.purge'));
-- DELETE FROM "Permission" WHERE "code" IN ('leads.delete', 'customers.delete', 'governance.deletions.view', 'governance.deletions.restore', 'governance.deletions.purge');
-- COMMIT;
