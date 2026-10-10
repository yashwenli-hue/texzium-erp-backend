-- AdminOS: permissions for administering users, roles and permissions.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
--
-- Creates two permission codes:
--   roles.permissions.assign  assign a permission to a role (POST /role-permissions); the
--                             caller must also hold the permission being assigned
--   permissions.manage        add a code to the permission catalogue (POST /permissions)
--
-- and grants these five to SUPER_ADMIN only (users.view, roles.view and roles.create
-- already exist but were never granted to any role):
--   users.view                read the user directory (GET /users)
--   roles.view                read roles, the permission catalogue and role assignments
--                             (GET /roles, GET /permissions, GET /role-permissions)
--   roles.create              create a role (POST /roles)
--   roles.permissions.assign
--   permissions.manage
--
-- Permissions are copied into the login token, so a signed-in user needs to log in
-- again before the new permissions apply to their session. Until then GET /users
-- (used by the lead assign and qualify dialogs) answers 403 for that session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261012_identity_admin_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'AdminOS'
FROM (VALUES
  ('roles.permissions.assign', 'Assign Permissions to Roles'),
  ('permissions.manage',       'Manage Permissions')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('users.view', 'roles.view', 'roles.create', 'roles.permissions.assign', 'permissions.manage')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes SUPER_ADMIN's five grants and the two codes created here; the
-- pre-existing users.view, roles.view and roles.create codes are kept):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "roleId" = (SELECT "id" FROM "Role" WHERE "name" = 'SUPER_ADMIN')
--    AND "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('users.view', 'roles.view', 'roles.create', 'roles.permissions.assign', 'permissions.manage'));
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('roles.permissions.assign', 'permissions.manage'));
-- DELETE FROM "Permission" WHERE "code" IN ('roles.permissions.assign', 'permissions.manage');
-- COMMIT;
