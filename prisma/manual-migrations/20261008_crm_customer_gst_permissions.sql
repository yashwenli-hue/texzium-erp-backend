-- CRM: permission for managing Customer GST registrations.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission code below and grants it to SUPER_ADMIN only. The
-- Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   customers.gst.manage   add, edit, deactivate and reactivate a customer's
--                          GST registrations, and choose its default
--
-- Viewing registrations needs customers.view.
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permission applies to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261008_crm_customer_gst_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('customers.gst.manage', 'Manage Customer GST Registrations')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'customers.gst.manage'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grant and the permission only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--   WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'customers.gst.manage');
-- DELETE FROM "Permission" WHERE "code" = 'customers.gst.manage';
-- COMMIT;
