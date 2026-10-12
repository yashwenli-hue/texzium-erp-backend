-- Documents: permission to maintain the company document profile.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission code below and grants it to SUPER_ADMIN only. The
-- Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   documents.profile.manage   read and change what the company prints on its
--                              documents (registered office, logo, bank
--                              details, terms, authorised signatory)
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permission applies to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261015_company_document_profile_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, 'documents.profile.manage', 'Manage Document Profile', 'AdminOS'
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'documents.profile.manage'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grant and the permission only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'documents.profile.manage');
-- DELETE FROM "Permission" WHERE "code" = 'documents.profile.manage';
-- COMMIT;
