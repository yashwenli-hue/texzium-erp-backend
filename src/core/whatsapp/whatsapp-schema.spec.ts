import * as fs from 'fs';
import * as path from 'path';

// The WhatsApp permission migration: exactly the approved codes, granted to SUPER_ADMIN
// only, idempotent, with a documented rollback.

const SQL = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    'prisma',
    'manual-migrations',
    '20261013_whatsapp_permissions.sql',
  ),
  'utf8',
);
const body = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const [insertPermissions, grant] = body.split('INSERT INTO "RolePermission"');
const CODES = [
  'whatsapp.config.manage',
  'whatsapp.config.view',
  'whatsapp.messages.send',
];

describe('20261013_whatsapp_permissions.sql', () => {
  it('runs in one transaction and changes no schema', () => {
    expect(body.trim().startsWith('BEGIN;')).toBe(true);
    expect(body.trim().endsWith('COMMIT;')).toBe(true);
    expect(body).not.toMatch(/\b(ALTER|CREATE|DROP|TRUNCATE|DELETE|UPDATE)\b/);
  });

  it('creates exactly the three codes, idempotently', () => {
    const codes = [...insertPermissions.matchAll(/\('([a-z.]+)',\s*'/g)].map(
      (m) => m[1],
    );

    expect(codes.sort()).toEqual(CODES);
    expect(insertPermissions).toContain('ON CONFLICT ("code") DO NOTHING');
  });

  it('grants exactly those three, to SUPER_ADMIN only, idempotently', () => {
    const list = /p\."code" IN \(([^)]*)\)/.exec(grant)?.[1] ?? '';
    const codes = [...list.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]).sort();

    expect(codes).toEqual(CODES);
    expect(grant).toContain(`WHERE r."name" = 'SUPER_ADMIN'`);
    expect(grant.match(/r\."name"/g)).toHaveLength(1);
    expect(grant).toContain(
      'ON CONFLICT ("roleId", "permissionId") DO NOTHING',
    );
  });

  it('documents a rollback', () => {
    expect(SQL).toContain('-- Rollback');
    expect(SQL).toContain(
      `-- DELETE FROM "Permission" WHERE "code" IN ('whatsapp.config.view', 'whatsapp.config.manage', 'whatsapp.messages.send');`,
    );
  });
});
