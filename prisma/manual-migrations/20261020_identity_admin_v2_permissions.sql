-- Identity administration v2: revoking permissions and managing users' roles and status.
--
-- Data only (no schema change) and idempotent. Creates the codes below and grants them to
-- SUPER_ADMIN only:
--
--   roles.permissions.revoke   take permissions away from a role (PATCH /roles/:id/permissions
--                              "revoke"); only permissions the caller holds
--   users.role.assign          move a user to another role (PATCH /users/:id/role); the caller
--                              must hold every permission of the new role; never their own
--   users.status.manage        activate, deactivate or suspend a user (PATCH /users/:id/status);
--                              never their own
--
-- Every change is audited (AuditLog, GET /identity-audit) and refused when it would leave no
-- active user able to assign permissions. Sign in again to receive the new codes.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261020_identity_admin_v2_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'AdminOS'
FROM (VALUES
  ('roles.permissions.revoke', 'Revoke Permissions from Roles'),
  ('users.role.assign',        'Change a User''s Role'),
  ('users.status.manage',      'Activate, Deactivate or Suspend Users')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN ('roles.permissions.revoke', 'users.role.assign', 'users.status.manage')
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback:
-- BEGIN;
-- DELETE FROM "RolePermission" WHERE "permissionId" IN (SELECT "id" FROM "Permission"
--   WHERE "code" IN ('roles.permissions.revoke', 'users.role.assign', 'users.status.manage'));
-- DELETE FROM "Permission" WHERE "code" IN ('roles.permissions.revoke', 'users.role.assign', 'users.status.manage');
-- COMMIT;
