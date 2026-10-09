/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- the match results are strings by construction */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  DELETION_ENTITY,
  DELETION_REASON_CODES,
  DELETION_REASON_MAX_LENGTH,
  DELETION_STATUS,
  PURGE_METHOD,
  RECOVERY_WINDOW_DAYS,
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

  it('allows exactly the statuses the code has, and keeps each consistent with its lifecycle fields', () => {
    expect(listed(record, 'status')).toEqual(Object.values(DELETION_STATUS));
    expect(record).toMatch(
      /"status" = 'DELETED'\s+AND "entityId" IS NOT NULL AND "entityLabel" IS NOT NULL AND "reason" IS NOT NULL AND "deletedById" IS NOT NULL\s+AND "restoredAt" IS NULL AND "restoredById" IS NULL\s+AND "purgedAt" IS NULL AND "purgedById" IS NULL AND "purgeMethod" IS NULL/,
    );
    expect(record).toMatch(
      /"status" = 'RESTORED'\s+AND "entityId" IS NOT NULL AND "entityLabel" IS NOT NULL AND "reason" IS NOT NULL AND "deletedById" IS NOT NULL\s+AND "restoredAt" IS NOT NULL AND "restoredById" IS NOT NULL/,
    );
    expect(record).toMatch(
      /"status" = 'PURGED'\s+AND "purgedAt" IS NOT NULL AND "purgeMethod" IS NOT NULL/,
    );
  });

  it('records HOW a record was purged: MANUAL needs a user, AUTOMATIC has none and only counts strictly after the deadline; a PURGED row can never leave the method NULL', () => {
    expect(Object.values(PURGE_METHOD)).toEqual(['MANUAL', 'AUTOMATIC']);
    expect(record).toContain('"purgeMethod"   TEXT');
    expect(record).toContain(
      `("purgeMethod" = 'MANUAL' AND "purgedById" IS NOT NULL)`,
    );
    expect(record).toContain(
      `("purgeMethod" = 'AUTOMATIC' AND "purgedById" IS NULL AND "purgedAt" > "purgeAfter")`,
    );
    // a CHECK passes on NULL, so the method must be required explicitly (found by the scratch database)
    expect(record).toMatch(
      /"status" = 'PURGED'\s+AND "purgedAt" IS NOT NULL AND "purgeMethod" IS NOT NULL/,
    );
    expect(prismaSchema).toMatch(
      /model DataDeletionRecord \{[\s\S]*?purgeMethod String\?[\s\S]*?\n\}/,
    );
    // the trigger still lets only the two transitions through, and leaves the method to the CHECK
    expect(record).toContain("NEW.\"status\" IN ('RESTORED', 'PURGED')");
  });

  it('no longer says there is no automatic purge: the migration documents the inclusive deadline and the two purge paths', () => {
    expect(record).not.toMatch(/deliberately no automatic purge/i);
    expect(record).toMatch(/now <= purgeAfter/);
    expect(record).toMatch(/MANUAL/);
    expect(record).toMatch(/AUTOMATIC/);
  });

  it('stores the deadline (purgeAfter) as a column, never after-the-fact computed; the code fixes 30 days at first', () => {
    expect(record).toContain('"purgeAfter"    TIMESTAMP(3) NOT NULL');
    expect(record).toContain('CHECK ("purgeAfter" >= "deletedAt")');
    expect(RECOVERY_WINDOW_DAYS).toBe(30);
  });

  it('guards the lifecycle with triggers: only DELETED -> RESTORED / PURGED, nothing else, never DELETE or TRUNCATE', () => {
    expect(record).toMatch(/BEFORE UPDATE OR DELETE ON "DataDeletionRecord"/);
    expect(record).toMatch(/BEFORE TRUNCATE ON "DataDeletionRecord"/);
    expect(record).toContain('OLD."status" = \'DELETED\'');
    expect(record).toContain("NEW.\"status\" IN ('RESTORED', 'PURGED')");
    expect(record).toContain(
      'NEW."snapshot"      = \'{"purged": true}\'::jsonb',
    );
    expect(record).toContain('restrict_violation');
    for (const column of [
      'entityType',
      'entityId',
      'reasonCode',
      'deletedAt',
      'purgeAfter',
    ]) {
      expect(record).toContain(`NEW."${column}"`);
    }
  });

  describe('minimal retention after a purge', () => {
    const ERASED = [
      'entityId',
      'entityCode',
      'entityLabel',
      'reason',
      'survivorId',
      'survivorLabel',
      'deletedById',
    ];
    // unchanged by BOTH transitions. (entityId is unchanged by a restore and ERASED by a purge.)
    const KEPT = ['id', 'entityType', 'reasonCode', 'deletedAt', 'purgeAfter'];
    const guard = record.slice(
      record.indexOf('CREATE OR REPLACE FUNCTION "DataDeletionRecord_guard"'),
      record.indexOf('DROP TRIGGER IF EXISTS "DataDeletionRecord_no_change"'),
    );
    const purgedBranch = guard.slice(guard.indexOf(`NEW."status" = 'PURGED'`));
    const purgedCheck = record.slice(
      record.indexOf(`OR ("status" = 'PURGED'`),
      record.indexOf('CONSTRAINT "DataDeletionRecord_purgedAt_check"'),
    );

    it('the purged column set: the name and personal data columns are nullable (erasable); the identity and timing columns are not', () => {
      for (const column of [
        'entityId',
        'entityLabel',
        'reason',
        'deletedById',
      ]) {
        expect(record).toMatch(new RegExp(`"${column}"\\s+TEXT,`));
      }
      for (const column of [
        'entityType',
        'reasonCode',
        'deletedAt',
        'purgeAfter',
      ]) {
        expect(record).toMatch(
          new RegExp(`"${column}"\\s+(TEXT|TIMESTAMP\\(3\\))\\s+NOT NULL`),
        );
      }
    });

    it('the trigger lets a purge through only with everything erased: each erased column must be NULL (and the impact {} and the snapshot the marker)', () => {
      for (const column of ERASED) {
        expect(purgedBranch).toMatch(
          new RegExp(`NEW\\."${column}"\\s+IS NULL`),
        );
      }
      expect(purgedBranch).toMatch(/NEW\."impact"\s+= '\{\}'::jsonb/);
      expect(purgedBranch).toMatch(
        /NEW\."snapshot"\s+= '\{"purged": true\}'::jsonb/,
      );
    });

    it('the trigger keeps the identity and the timing as they were, for both transitions', () => {
      const head = guard.slice(0, guard.indexOf(`NEW."status" = 'RESTORED'`));
      for (const column of KEPT) {
        expect(head).toMatch(
          new RegExp(
            `NEW\\."${column}"\\s+IS NOT DISTINCT FROM OLD\\."${column}"`,
          ),
        );
      }
    });

    it('a RESTORED transition changes nothing but the lifecycle fields', () => {
      const restored = guard.slice(
        guard.indexOf(`NEW."status" = 'RESTORED'`),
        guard.indexOf(`NEW."status" = 'PURGED'`),
      );
      for (const column of [...ERASED, 'impact', 'snapshot']) {
        expect(restored).toMatch(
          new RegExp(
            `NEW\\."${column}"\\s+IS NOT DISTINCT FROM OLD\\."${column}"`,
          ),
        );
      }
    });

    it('the CHECK says the same, so the rule holds even with the trigger out of the way: a PURGED row has all of it NULL / empty, a DELETED or RESTORED row has its name, reason and deleter', () => {
      for (const column of ERASED) {
        expect(purgedCheck).toMatch(new RegExp(`"${column}" IS NULL`));
      }
      expect(purgedCheck).toContain(`"impact" = '{}'::jsonb`);
      expect(purgedCheck).toContain(`"snapshot" = '{"purged": true}'::jsonb`);
      expect(record).toMatch(/"purgedAt" IS NULL OR "purgedAt" >= "deletedAt"/);
    });

    it('documents what is kept and why: the retained fields and the reason-code decision', () => {
      expect(record).toMatch(/kept\s+id \(the tombstone's own id/);
      expect(record).toMatch(
        /ORIGINAL id of\s+--\s+the lead or customer \(entityId/,
      );
      expect(record).toMatch(
        /reasonCode \(one of\s+--\s+five fixed categories, never free text/,
      );
      expect(record).toMatch(/erased\s+snapshot/);
    });
  });

  it('has foreign keys only to the people who acted (original ids are plain columns)', () => {
    expect((record.match(/FOREIGN KEY/g) ?? []).length).toBe(3);
    for (const column of ['deletedById', 'restoredById', 'purgedById']) {
      expect(record).toContain(
        `FOREIGN KEY ("${column}") REFERENCES "User"("id") ON DELETE RESTRICT`,
      );
    }
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
      'purgeMethod',
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
    expect(model).toContain('@@index([status, deletedAt])');
    expect(model).toContain('@@index([deletedAt])');
    expect(model).toContain('@@index([deletedById])');
  });
});

describe('the permissions migration', () => {
  const FIVE = [
    'leads.delete',
    'customers.delete',
    'governance.deletions.view',
    'governance.deletions.restore',
    'governance.deletions.purge',
  ];
  // The statements that run (everything after the header comment and before the rollback).
  const active = permissions
    .split('-- Rollback')[0]
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const codesIn = (text: string) =>
    [...text.matchAll(/'((?:leads|customers|governance)\.[a-z.]+)'/g)].map(
      (m) => m[1],
    );

  it('creates exactly the five permissions, no more and no fewer', () => {
    const values = active.slice(
      active.indexOf('FROM (VALUES'),
      active.indexOf(') AS v'),
    );
    expect(codesIn(values).sort()).toEqual([...FIVE].sort());
  });

  it('grants exactly those five, and only to SUPER_ADMIN', () => {
    const grant = active.slice(active.indexOf('INSERT INTO "RolePermission"'));
    expect(codesIn(grant).sort()).toEqual([...FIVE].sort());
    expect(grant).toContain(`WHERE r."name" = 'SUPER_ADMIN'`);
    // no other role is named anywhere in what runs, and nothing grants to every role
    expect((active.match(/"name" = '/g) ?? []).length).toBe(1);
    expect(active).not.toMatch(
      /FROM "Role" r\s*(CROSS JOIN|JOIN "Permission" p ON TRUE)/i,
    );
    expect(active).not.toMatch(/"name" (<>|!=|IN|LIKE)/i);
  });

  it('changes data only, and is safe to run again', () => {
    expect(active).not.toMatch(
      /ALTER TABLE|CREATE TABLE|DROP |TRUNCATE|UPDATE "|DELETE FROM/,
    );
    expect(permissions).toContain('ON CONFLICT ("code") DO NOTHING');
    expect(permissions).toContain(
      'ON CONFLICT ("roleId", "permissionId") DO NOTHING',
    );
  });

  it('has a rollback that removes only these five and their grants', () => {
    const rollback = permissions.slice(permissions.indexOf('-- Rollback'));
    expect(codesIn(rollback).sort()).toEqual([...FIVE, ...FIVE].sort());
  });
});
