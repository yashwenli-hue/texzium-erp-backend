-- RevenueOS sales enablement: permissions for the content library.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants them to SUPER_ADMIN only. The
-- Permission and RolePermission ids have no database default, so they are generated
-- here.
--
--   content.view     browse the library, view and download content
--   content.manage   upload content and new versions, edit, archive and restore
--   content.share    record content shared with a lead, opportunity or customer
--
-- Permissions are copied into the login token, so a signed-in user needs to log in
-- again before they apply.
--
-- Apply (after 20261018_content_library.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261018_content_library_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('content.view',   'View Sales Content'),
  ('content.manage', 'Manage Sales Content'),
  ('content.share',  'Share Sales Content')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('content.view', 'content.manage', 'content.share')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('content.view', 'content.manage', 'content.share'));
-- DELETE FROM "Permission" WHERE "code" IN ('content.view', 'content.manage', 'content.share');
-- COMMIT;
