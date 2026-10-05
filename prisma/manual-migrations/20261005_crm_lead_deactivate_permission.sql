-- CRM: permission for deactivating and reactivating leads.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission code leads.deactivate and grants it to SUPER_ADMIN.
-- The Permission and RolePermission ids have no database default, so they are
-- generated here.
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permission applies to their session.
--
-- Apply after 20261005_crm_lead_soft_deactivation.sql:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261005_crm_lead_deactivate_permission.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
VALUES (gen_random_uuid()::text, 'leads.deactivate', 'Deactivate Leads', 'RevenueOS')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'leads.deactivate'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grant and the permission):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--   WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'leads.deactivate');
-- DELETE FROM "Permission" WHERE "code" = 'leads.deactivate';
-- COMMIT;
