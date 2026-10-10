import * as fs from 'fs';
import * as path from 'path';

// The permission migration for identity administration: exactly the approved codes,
// granted to SUPER_ADMIN only, idempotent, with a rollback that keeps the codes that
// existed before it.

const SQL = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'prisma',
    'manual-migrations',
    '20261012_identity_admin_permissions.sql',
  ),
  'utf8',
);
const body = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const [insertPermissions, grant] = body.split('INSERT INTO "RolePermission"');

describe('20261012_identity_admin_permissions.sql', () => {
  it('runs in one transaction', () => {
    expect(body.trim().startsWith('BEGIN;')).toBe(true);
    expect(body.trim().endsWith('COMMIT;')).toBe(true);
  });

  it('creates exactly the two new codes, idempotently', () => {
    const codes = [...insertPermissions.matchAll(/\('([a-z.]+)',\s*'/g)].map(
      (m) => m[1],
    );

    expect(codes).toEqual(['roles.permissions.assign', 'permissions.manage']);
    expect(insertPermissions).toContain('ON CONFLICT ("code") DO NOTHING');
  });

  it('grants exactly the five approved codes, to SUPER_ADMIN only, idempotently', () => {
    const list = /p\."code" IN \(([^)]*)\)/.exec(grant)?.[1] ?? '';
    const codes = [...list.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]).sort();

    expect(codes).toEqual([
      'permissions.manage',
      'roles.create',
      'roles.permissions.assign',
      'roles.view',
      'users.view',
    ]);
    expect(grant).toContain(`WHERE r."name" = 'SUPER_ADMIN'`);
    expect(grant.match(/r\."name"/g)).toHaveLength(1);
    expect(grant).toContain(
      'ON CONFLICT ("roleId", "permissionId") DO NOTHING',
    );
  });

  it('changes no schema', () => {
    // SQL keywords are upper case; permission codes like roles.create are not.
    expect(body).not.toMatch(/\b(ALTER|CREATE|DROP|TRUNCATE)\b/);
    expect(body).not.toMatch(/\bDELETE\b|\bUPDATE\b/);
  });

  it('documents a rollback that keeps the pre-existing codes', () => {
    expect(SQL).toContain('-- Rollback');
    expect(SQL).toMatch(
      /-- DELETE FROM "Permission" WHERE "code" IN \('roles\.permissions\.assign', 'permissions\.manage'\);/,
    );
    expect(SQL).not.toMatch(/-- DELETE FROM "Permission"[^\n]*users\.view/);
  });
});
