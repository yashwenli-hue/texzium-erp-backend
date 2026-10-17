-- Finance visibility and payment-gateway settings — two permission codes.
--
-- Data only (no schema change) and idempotent.
--
--   finance.view.all          see every FINANCIAL record (sales invoices, receivables,
--                             payments, advance receipts, receipt vouchers, customer
--                             statements, collection reminders) and use the company-wide
--                             FinanceOS, BI and GST-compliance routes, WITHOUT seeing every
--                             lead, opportunity, quotation or customer record. The code is
--                             created but GRANTED TO NOBODY: giving it to a Finance role is a
--                             separate decision (on /access; revenue.view.all, which
--                             SUPER_ADMIN holds, includes it, so an administrator can
--                             delegate it without being granted it first).
--
--   payments.gateway.manage   read and change the payment-gateway settings (API key, secret,
--                             receiving bank account). Those routes had only the login check
--                             before; they now need this code, and the secrets are masked in
--                             every response. Granted to SUPER_ADMIN only, which keeps what
--                             every current user can do exactly as it is.
--
-- The backend built from the same commit enforces both. Permissions are copied into the
-- login token: users must sign in again after activation (until they do, their old token
-- lacks payments.gateway.manage, and also revenue.view.all if they signed in before the
-- 20261020 migrations).
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261021_finance_visibility_and_gateway_permissions.sql

BEGIN;

INSERT INTO "Permission" ("id", "code", "name", "module")
VALUES (gen_random_uuid()::text, 'finance.view.all', 'See Every Financial Record', 'FinanceOS')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "Permission" ("id", "code", "name", "module")
VALUES (gen_random_uuid()::text, 'payments.gateway.manage', 'Manage Payment Gateway Settings', 'AdminOS')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM "Role" r
JOIN "Permission" p ON p."code" = 'payments.gateway.manage'
WHERE r."name" = 'SUPER_ADMIN'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

COMMIT;

-- Rollback (only together with the code rollback):
-- BEGIN;
-- DELETE FROM "RolePermission"
--  WHERE "permissionId" IN (SELECT "id" FROM "Permission" WHERE "code" IN ('finance.view.all', 'payments.gateway.manage'));
-- DELETE FROM "Permission" WHERE "code" IN ('finance.view.all', 'payments.gateway.manage');
-- COMMIT;
