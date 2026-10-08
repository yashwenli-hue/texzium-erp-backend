/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- the match results are strings by construction */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  DELETION_ENTITY,
  DELETION_REASON_CODES,
  DELETION_REASON_MAX_LENGTH,
} from './data-deletion';

// The database enforces the same shape as the code, so the two must not drift: the
// reason codes, the entity types, the reason length, the append-only trigger and the
// permissions. (The migration is applied and rehearsed on a scratch database; this
// guards its text.)

const MIGRATIONS = join(__dirname, '../../../../prisma/manual-migrations');
const record = readFileSync(
  join(MIGRATIONS, '20261011_crm_data_deletion_record.sql'),
  'utf8',
);
const permissions = readFileSync(
  join(MIGRATIONS, '20261011_crm_data_deletion_permissions.sql'),
  'utf8',
);
const prismaSchema = readFileSync(
  join(__dirname, '../../../../prisma/schema.prisma'),
  'utf8',
);

const listed = (sql: string, column: string) => {
  const match = new RegExp(`"${column}" IN \\(([^)]*)\\)`).exec(sql);
  return (match?.[1].match(/'([A-Z_]+)'/g) ?? []).map((v) =>
    v.replace(/'/g, ''),
  );
};

describe('the DataDeletionRecord migration matches the code', () => {
  it('allows exactly the reason codes the code allows', () => {
    expect(listed(record, 'reasonCode')).toEqual([...DELETION_REASON_CODES]);
  });

  it('allows exactly the entity types the code allows', () => {
    expect(listed(record, 'entityType')).toEqual(
      Object.values(DELETION_ENTITY),
    );
  });

  it('limits the reason to 1..500 characters, as the code does', () => {
    expect(DELETION_REASON_MAX_LENGTH).toBe(500);
    expect(record).toContain('char_length(btrim("reason")) BETWEEN 1 AND 500');
  });

  it('allows a survivor only for a DUPLICATE and never the record itself, with its label', () => {
    expect(record).toMatch(
      /"reasonCode" = 'DUPLICATE' AND "survivorId" <> "entityId"/,
    );
    expect(record).toContain(
      '"survivorId" IS NULL AND "survivorLabel" IS NULL',
    );
  });

  it('refuses UPDATE, DELETE and TRUNCATE with triggers', () => {
    expect(record).toMatch(/BEFORE UPDATE OR DELETE ON "DataDeletionRecord"/);
    expect(record).toMatch(/BEFORE TRUNCATE ON "DataDeletionRecord"/);
    expect(record).toContain('restrict_violation');
  });

  it('has only one foreign key: the person who deleted (original ids are plain columns)', () => {
    expect((record.match(/FOREIGN KEY/g) ?? []).length).toBe(1);
    expect(record).toContain(
      'FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT',
    );
  });

  it('is additive and repeatable: every create is guarded, and it changes no existing table', () => {
    expect(record).toContain('CREATE TABLE IF NOT EXISTS "DataDeletionRecord"');
    expect(record.match(/CREATE INDEX/g)?.length).toBe(
      record.match(/CREATE INDEX IF NOT EXISTS/g)?.length,
    );
    expect(record).not.toMatch(
      /ALTER TABLE|UPDATE "|DELETE FROM|INSERT INTO "(?!Permission|RolePermission)/,
    );
  });

  it('declares the same table and indexes as the Prisma schema', () => {
    const model =
      /model DataDeletionRecord \{([\s\S]*?)\n\}/.exec(prismaSchema)?.[1] ?? '';
    for (const column of [
      'entityType',
      'entityId',
      'entityCode',
      'entityLabel',
      'reasonCode',
      'reason',
      'survivorId',
      'survivorLabel',
      'snapshot',
      'impact',
      'deletedById',
      'deletedAt',
    ]) {
      expect(model).toContain(column);
      expect(record).toContain(`"${column}"`);
    }
    expect(model).toContain('@@index([entityType, entityId])');
    expect(model).toContain('@@index([deletedAt])');
    expect(model).toContain('@@index([deletedById])');
  });
});

describe('the permissions migration', () => {
  it('creates leads.delete, customers.delete and governance.deletions.view and grants them to SUPER_ADMIN only', () => {
    for (const code of [
      'leads.delete',
      'customers.delete',
      'governance.deletions.view',
    ]) {
      expect(permissions).toContain(`'${code}'`);
    }
    expect(permissions).toContain(`WHERE r."name" = 'SUPER_ADMIN'`);
    expect((permissions.match(/"name" = '/g) ?? []).length).toBe(1);
    expect(permissions).toContain('ON CONFLICT ("code") DO NOTHING');
    expect(permissions).toContain(
      'ON CONFLICT ("roleId", "permissionId") DO NOTHING',
    );
  });
});
