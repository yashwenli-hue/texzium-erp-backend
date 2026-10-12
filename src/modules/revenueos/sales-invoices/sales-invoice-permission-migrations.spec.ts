import * as fs from 'fs';
import * as path from 'path';

const dir = path.join(__dirname, '../../../../prisma/manual-migrations');
const sql = (file: string) =>
  fs
    .readFileSync(path.join(dir, file), 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

// Issuing an invoice takes a permanent number, so the grant that allows it is
// a migration of its own, applied only once the number format is approved.
describe('sales invoice permission migrations', () => {
  const permissions = sql('20261015_sales_invoice_permissions.sql');
  const createGrant = sql('20261017_sales_invoice_create_grant.sql');
  const granted = (s: string) =>
    [...s.matchAll(/JOIN "Permission" p ON p\."code"\s*(=|IN)\s*([^\n]+)/g)]
      .map((m) => m[2])
      .join(' ');

  it('creates invoices.view and invoices.create', () => {
    expect(permissions).toContain("('invoices.view',");
    expect(permissions).toContain("('invoices.create',");
  });

  it('grants invoices.view only: invoices.create stays ungranted', () => {
    expect(granted(permissions)).toBe("'invoices.view'");
    expect(permissions.match(/INSERT INTO "RolePermission"/g)).toHaveLength(1);
  });

  it('the separate grant migration grants invoices.create only, to SUPER_ADMIN, and creates no permission', () => {
    expect(granted(createGrant)).toBe("'invoices.create'");
    expect(createGrant).toContain(`WHERE r."name" = 'SUPER_ADMIN'`);
    expect(createGrant).not.toMatch(/INSERT INTO "Permission"/);
    expect(createGrant).toMatch(
      /RAISE EXCEPTION 'invoices\.create does not exist/,
    );
  });
});
