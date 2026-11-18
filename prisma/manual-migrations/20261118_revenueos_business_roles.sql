-- RevenueOS business roles: PRE_SALES, SALES, SALES_MANAGER, FINANCE.
--
-- Data only (no schema change), additive and idempotent: it creates the four roles if
-- they do not exist and grants them the codes below. It never removes a grant, never
-- changes SUPER_ADMIN and never assigns anyone to a role (users are given a role
-- separately). Re-running it changes nothing. Any code below that the live Permission
-- table lacks is created first (the original lead and opportunity codes predate these
-- files), so every grant lands.
--
-- Decisions (confirmed 2026-11-18):
--   * a salesperson approves or rejects their own quotations and proformas;
--   * FINANCE sees every financial record and every sales order (finance.view.all),
--     but no leads, opportunities, quotations, proformas or customer master;
--   * SALES_MANAGER sees everything (revenue.view.all, which includes finance
--     visibility and the company-wide money totals);
--   * printing the tax-invoice PDF (invoices.document.view) is NOT granted: it stays
--     ungranted until the invoice print format is approved (see
--     20261016_tax_invoice_document_permission.sql); grant it then on /access.
-- Record scope (who sees which record) is enforced by the backend: PRE_SALES and SALES
-- see the leads assigned to them or that they worked on, and the deals, customers and
-- documents under those leads. Needs the backend from commit "finance works from the
-- sales order" or later for FINANCE to reach sales orders.
--
-- Permissions are copied into the login token: a user sees a change after signing in
-- again. Fine-tune any role afterwards on /access.
--
-- Apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261118_revenueos_business_roles.sql

BEGIN;

CREATE TEMP TABLE _grant (role_name text, code text, module text) ON COMMIT DROP;

-- PRE_SALES: works leads up to qualification.
INSERT INTO _grant (role_name, code, module)
SELECT 'PRE_SALES', c, 'RevenueOS' FROM unnest(ARRAY[
  'leads.view', 'leads.create', 'leads.edit', 'leads.status.update',
  'leads.qualify', 'leads.reject',
  'leads.followups.view', 'leads.followups.create',
  'customers.view',
  'content.view', 'content.share'
]) AS c;

-- SALES: everything PRE_SALES does, plus the deal from opportunity to sales order.
INSERT INTO _grant (role_name, code, module)
SELECT 'SALES', code, module FROM _grant WHERE role_name = 'PRE_SALES';
INSERT INTO _grant (role_name, code, module)
SELECT 'SALES', c, 'RevenueOS' FROM unnest(ARRAY[
  'opportunities.view', 'opportunities.create', 'opportunities.edit',
  'customers.create', 'customers.edit', 'customers.gst.manage',
  'quotations.view', 'quotations.create', 'quotations.edit',
  'quotations.approve', 'quotations.reject',
  'proformas.view', 'proformas.create', 'proformas.approve', 'proformas.cancel',
  'salesorders.view', 'salesorders.create',
  'salesorders.paymentterms.view', 'salesorders.paymentterms.create',
  'salesorders.advancereceipts.view', 'salesorders.commercialapproval.view',
  'invoices.view', 'collections.view'
]) AS c;

-- SALES_MANAGER: everything SALES does, plus routing leads, reopening them,
-- cancelling orders, and seeing every record.
INSERT INTO _grant (role_name, code, module)
SELECT 'SALES_MANAGER', code, module FROM _grant WHERE role_name = 'SALES';
INSERT INTO _grant (role_name, code, module)
SELECT 'SALES_MANAGER', c, 'RevenueOS' FROM unnest(ARRAY[
  'leads.assign', 'leads.reopen', 'salesorders.cancel', 'revenue.view.all'
]) AS c;

-- FINANCE: advance receipts, commercial approval, invoicing and collections,
-- with visibility of every financial record and sales order.
INSERT INTO _grant (role_name, code, module)
SELECT 'FINANCE', c, 'FinanceOS' FROM unnest(ARRAY[
  'invoices.view', 'invoices.create',
  'collections.view', 'collections.record',
  'salesorders.view', 'salesorders.paymentterms.view',
  'salesorders.advancereceipts.view', 'salesorders.advancereceipts.create',
  'salesorders.advancereceipts.verify', 'salesorders.advancereceipts.retract',
  'salesorders.commercialapproval.view', 'salesorders.commercialapproval.approve',
  'salesorders.commercialapproval.retract',
  'finance.view.all'
]) AS c;

-- The roles.
INSERT INTO "Role" ("id", "name", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'PRE_SALES', 'Works leads up to qualification', now(), now()),
  (gen_random_uuid()::text, 'SALES', 'Owns deals from opportunity to sales order', now(), now()),
  (gen_random_uuid()::text, 'SALES_MANAGER', 'Sales head: routes leads and sees every record', now(), now()),
  (gen_random_uuid()::text, 'FINANCE', 'Advance receipts, commercial approval, invoicing and collections', now(), now())
ON CONFLICT ("name") DO NOTHING;

-- Any code the table lacks (named after the code itself).
INSERT INTO "Permission" ("id", "code", "name", "module")
SELECT DISTINCT ON (g.code) gen_random_uuid()::text, g.code, g.code, g.module
FROM _grant g
WHERE NOT EXISTS (SELECT 1 FROM "Permission" p WHERE p."code" = g.code)
ORDER BY g.code
ON CONFLICT ("code") DO NOTHING;

-- The grants.
INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid()::text, r."id", p."id"
FROM (SELECT DISTINCT role_name, code FROM _grant) g
JOIN "Role" r ON r."name" = g.role_name
JOIN "Permission" p ON p."code" = g.code
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Every intended grant is in place, or nothing is committed.
DO $$
DECLARE missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM (SELECT DISTINCT role_name, code FROM _grant) g
  WHERE NOT EXISTS (
    SELECT 1 FROM "RolePermission" rp
    JOIN "Role" r ON r."id" = rp."roleId"
    JOIN "Permission" p ON p."id" = rp."permissionId"
    WHERE r."name" = g.role_name AND p."code" = g.code
  );
  IF missing > 0 THEN
    RAISE EXCEPTION '% intended grants are missing; nothing was changed.', missing;
  END IF;
END $$;

COMMIT;

-- What each role now holds.
SELECT r."name" AS role, count(*) AS permissions
FROM "Role" r JOIN "RolePermission" rp ON rp."roleId" = r."id"
WHERE r."name" IN ('PRE_SALES', 'SALES', 'SALES_MANAGER', 'FINANCE')
GROUP BY r."name" ORDER BY r."name";
