-- CRM: the permission to reopen a rejected lead.
--
-- Data only (no schema change) and idempotent. Creates the code below and grants it to
-- SUPER_ADMIN only:
--
--   leads.reopen   PATCH /lead-assignments/:id/reopen — a rejected lead back to
--                  Contacted, with a required reason; the rejection stays in history
--
-- Permissions are copied into the login token: sign in again to get it.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261019_crm_lead_reopen_permission.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
VALUES (gen_random_uuid()::text, 'leads.reopen', 'Reopen Rejected Leads', 'RevenueOS')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'leads.reopen'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback:
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'leads.reopen');
-- DELETE FROM "Permission" WHERE "code" = 'leads.reopen';
-- COMMIT;
