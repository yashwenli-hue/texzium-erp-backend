-- CRM: permissions for the Sales Order commercial workflow.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Creates the permission codes below and grants every one to SUPER_ADMIN. The
-- Permission and RolePermission ids have no database default, so they are
-- generated here.
--
--   salesorders.view                          view Sales Orders and their history
--   salesorders.create                        create a Sales Order
--   salesorders.paymentterms.view             view payment terms
--   salesorders.paymentterms.create           set payment terms
--   salesorders.advancereceipts.view          view advance receipts
--   salesorders.advancereceipts.create        record an advance receipt
--   salesorders.advancereceipts.verify        verify or reject an advance receipt
--   salesorders.commercialapproval.view       view accounts commercial approvals
--   salesorders.commercialapproval.approve    give accounts commercial approval
--
-- Permissions are copied into the login token, so a signed-in user needs to log
-- in again before the new permissions apply to their session.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261006_crm_sales_order_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT gen_random_uuid()::text, v."code", v."name", 'RevenueOS'
FROM (VALUES
  ('salesorders.view',                       'View Sales Orders'),
  ('salesorders.create',                     'Create Sales Orders'),
  ('salesorders.paymentterms.view',          'View Sales Order Payment Terms'),
  ('salesorders.paymentterms.create',        'Create Sales Order Payment Terms'),
  ('salesorders.advancereceipts.view',       'View Sales Order Advance Receipts'),
  ('salesorders.advancereceipts.create',     'Create Sales Order Advance Receipts'),
  ('salesorders.advancereceipts.verify',     'Verify Sales Order Advance Receipts'),
  ('salesorders.commercialapproval.view',    'View Accounts Commercial Approvals'),
  ('salesorders.commercialapproval.approve', 'Approve Accounts Commercial Approvals')
) AS v("code", "name")
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" LIKE 'salesorders.%'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grants and the permissions):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--   WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" LIKE 'salesorders.%');
-- DELETE FROM "Permission" WHERE "code" LIKE 'salesorders.%';
-- COMMIT;
