-- RevenueOS: let SUPER_ADMIN issue sales invoices.
--
-- Data only (no schema change) and idempotent: running it again changes nothing.
-- Grants invoices.create (created, ungranted, by
-- 20261015_sales_invoice_permissions.sql) to SUPER_ADMIN.
--
-- DO NOT APPLY until the accountant has approved the invoice number format
-- (SI<state code>/<financial year>/<5-digit sequence>, e.g. SI24/26-27/00001)
-- and the activation has been approved: the first invoice issued afterwards
-- takes a permanent, consecutive statutory number.
--
-- The script stops if 20261015_sales_invoice_permissions.sql has not been
-- applied (the permission must already exist).
--
-- Permissions are copied into the login token, so a signed-in user needs to
-- log in again before the grant applies.
--
-- Apply (after 20261015_sales_invoice_permissions.sql, on approval only):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261017_sales_invoice_create_grant.sql

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'invoices.create') THEN
    RAISE EXCEPTION 'invoices.create does not exist: apply 20261015_sales_invoice_permissions.sql first.';
  END IF;
END
$$;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'invoices.create'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (removes the grant only; the permission stays, ungranted):
--
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" = 'invoices.create');
-- COMMIT;
