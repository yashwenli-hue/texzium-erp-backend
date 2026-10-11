-- Documents: a permission for listing and downloading documents.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission code below and grants it to SUPER_ADMIN only:
--
--   documents.view   list documents (GET /documents) and download a document's file
--                    (GET /documents/:id/download); only files inside the backend's
--                    uploads directory are served, and file paths are never returned
--
-- There is no route that registers a document: documents are created by the server
-- itself (commissioning certificates).
--
-- Permissions are copied into the login token, so a signed-in user needs to log in
-- again before the new permission applies to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261014_document_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
VALUES (gen_random_uuid()::text, 'documents.view', 'View Documents', 'DocumentOS')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'documents.view'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the code):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'documents.view');
-- DELETE FROM "Permission" WHERE "code" = 'documents.view';
-- COMMIT;
