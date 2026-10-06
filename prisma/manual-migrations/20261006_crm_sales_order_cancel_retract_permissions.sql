-- CRM: permissions for retracting and cancelling a Sales Order.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the three permission codes below and grants them to SUPER_ADMIN only.
-- The Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   salesorders.advancereceipts.retract       retract an advance receipt verification
--   salesorders.commercialapproval.retract    retract an accounts commercial approval
--   salesorders.cancel                        cancel a Sales Order
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permissions apply to their session.
--
-- Apply (after 20261006_crm_sales_order_permissions.sql):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261006_crm_sales_order_cancel_retract_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('salesorders.advancereceipts.retract',    'Retract Sales Order Advance Receipt Verifications'),
  ('salesorders.commercialapproval.retract', 'Retract Accounts Commercial Approvals'),
  ('salesorders.cancel',                     'Cancel Sales Orders')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" IN (
  'salesorders.advancereceipts.retract',
  'salesorders.commercialapproval.retract',
  'salesorders.cancel'
)
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the three permissions only):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--   WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN (
--     'salesorders.advancereceipts.retract',
--     'salesorders.commercialapproval.retract',
--     'salesorders.cancel'));
-- DELETE FROM "Permission" WHERE "code" IN (
--   'salesorders.advancereceipts.retract',
--   'salesorders.commercialapproval.retract',
--   'salesorders.cancel');
-- COMMIT;
