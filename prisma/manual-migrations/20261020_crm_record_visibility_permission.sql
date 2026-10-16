-- CRM: record visibility — the permission to see every RevenueOS record.
--
-- Data only (no schema change) and idempotent. Creates the code below and grants it to
-- SUPER_ADMIN only:
--
--   revenue.view.all   see every lead, opportunity, customer and sales document, the
--                      company-wide sales reports and the collection reminders. Without
--                      it a person sees only the records they work on (assigned to them,
--                      named in their history, created or changed by them, and the
--                      documents under those); everything else answers "not found".
--
-- The backend built from this commit enforces that scope on every RevenueOS route. Every
-- role that should keep seeing everything must hold this permission BEFORE that build
-- starts: today only SUPER_ADMIN has users, so granting it to SUPER_ADMIN keeps what every
-- current user sees exactly as it is. No other role is granted it here (a business decision).
--
-- Permissions are copied into the login token: users must sign in again after activation
-- (until they do, their old token lacks this code and they see only their own records).
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261020_crm_record_visibility_permission.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
VALUES (gen_random_uuid()::text, 'revenue.view.all', 'See Every RevenueOS Record', 'RevenueOS')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'revenue.view.all'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (only together with the code rollback: the scoped backend without this grant
-- would show each administrator only their own records):
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'revenue.view.all');
-- DELETE FROM "Permission" WHERE "code" = 'revenue.view.all';
-- COMMIT;
