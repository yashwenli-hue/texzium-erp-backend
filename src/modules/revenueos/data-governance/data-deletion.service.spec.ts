/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/unbound-method, @typescript-eslint/only-throw-error, @typescript-eslint/no-unnecessary-type-assertion -- test doubles are intentionally loosely typed */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  DELETION_CODE,
  DELETION_MESSAGE,
  DeletionPolicy,
  DeletionEvaluation,
  versionOf,
} from './data-deletion';
import { DataDeletionService } from './data-deletion.service';

jest.mock('./deletion-policies', () => ({ policyFor: jest.fn() }));
import { policyFor } from './deletion-policies';

// The shared deletion rules, with a policy double: what the service itself guarantees,
// whatever kind of record it is deleting. (The lead's own rules are in
// lead-deletion.policy.spec.ts; the real database, the locks and the races are proven
// on a scratch database.)

const NOW = new Date('2026-10-11T10:00:00.000Z');
const ID = '00000000-0000-4000-8000-0000000000a1';
const SURVIVOR = '00000000-0000-4000-8000-0000000000b2';
const ACTOR = 'user-1';

function setup(options: {
  evaluation?: Partial<DeletionEvaluation> | null;
  existing?: string[];
  removeError?: unknown;
  actorExists?: boolean;
}) {
  const log: string[] = [];
  const tombstones: any[] = [];
  let committed = false;

  const evaluation: DeletionEvaluation | null =
    options.evaluation === null
      ? null
      : {
          label: 'Sterling Pumps',
          code: 'L-1',
          blockers: [],
          removes: [{ label: 'The lead record', count: 1 }],
          version: versionOf({ a: 1 }),
          ...options.evaluation,
        };

  const policy: DeletionPolicy = {
    entityType: 'LEAD',
    noun: 'lead',
    notFoundMessage: 'Lead not found.',
    blockerCodes: ['X', 'Y'],
    lockRows: jest.fn(async (_tx, ids: string[]) => {
      log.push(`lock:${ids.join(',')}`);
      return ids.filter((id) =>
        (options.existing ?? [ID, SURVIVOR]).includes(id),
      );
    }),
    evaluate: jest.fn(async () => {
      log.push('evaluate');
      return evaluation;
    }),
    survivorLabel: jest.fn(async () => 'Survivor Ltd'),
    redactSurvivorEvents: jest.fn(async () => undefined),
    capture: jest.fn(async () => {
      log.push('capture');
      return { lead: { id: ID } } as unknown as Prisma.InputJsonValue;
    }),
    remove: jest.fn(async () => {
      log.push('remove');
      if (options.removeError) throw options.removeError;
    }),
    recordSurvivorEvent: jest.fn(async () => {
      log.push('survivorEvent');
    }),
    restoreEvaluate: jest.fn(async () => ({
      conflicts: [],
      restores: [],
      facts: {},
    })),
    lockForRestore: jest.fn(async () => undefined),
    restore: jest.fn(async () => undefined),
    recordSurvivorRestored: jest.fn(async () => undefined),
  };

  const tx = {
    dataDeletionRecord: {
      create: jest.fn(async (args: any) => {
        log.push('tombstone');
        tombstones.push(args.data);
        return {
          id: 'ts-1',
          deletedAt: args.data.deletedAt,
          purgeAfter: args.data.purgeAfter,
        };
      }),
    },
  };

  const prisma: any = {
    user: {
      findUnique: jest.fn(async () =>
        options.actorExists === false ? null : { id: ACTOR },
      ),
    },
    // An interactive transaction: what it staged is discarded if it throws.
    $transaction: jest.fn(async (fn: any) => {
      const staged = tombstones.length;
      try {
        const result = await fn(tx);
        committed = true;
        return result;
      } catch (error) {
        tombstones.length = staged;
        log.push('rollback');
        throw error;
      }
    }),
  };

  return {
    service: new DataDeletionService(prisma, () => NOW),
    policy,
    log,
    tombstones,
    prisma,
    committed: () => committed,
    version: evaluation?.version ?? '',
  };
}

const input = (over: Record<string, unknown> = {}) => ({
  reasonCode: 'ENTERED_IN_ERROR' as const,
  reason: 'Typed twice by mistake',
  version: versionOf({ a: 1 }),
  ...over,
});

const errorOf = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error as any;
  }
};

describe('DataDeletionService.delete', () => {
  it('locks, re-checks, writes the tombstone, then removes: in that order, with the actor from the caller', async () => {
    const t = setup({});
    const result = await t.service.delete(t.policy, ID, input(), ACTOR);

    expect(t.log).toEqual([
      'lock:' + ID,
      'evaluate',
      'capture',
      'tombstone',
      'remove',
    ]);
    expect(result).toMatchObject({
      id: 'ts-1',
      entityType: 'LEAD',
      entityId: ID,
      label: 'Sterling Pumps',
      reasonCode: 'ENTERED_IN_ERROR',
      survivorId: null,
      purgeAfter: new Date('2026-11-10T10:00:00.000Z'),
    });
    expect(t.tombstones[0]).toMatchObject({
      entityType: 'LEAD',
      entityId: ID,
      entityCode: 'L-1',
      entityLabel: 'Sterling Pumps',
      reasonCode: 'ENTERED_IN_ERROR',
      reason: 'Typed twice by mistake',
      survivorId: null,
      survivorLabel: null,
      deletedById: ACTOR,
      deletedAt: NOW,
      // the deadline is STORED: deletedAt + 30 days
      purgeAfter: new Date('2026-11-10T10:00:00.000Z'),
    });
    expect(t.tombstones[0].impact).toEqual({
      removed: [{ label: 'The lead record', count: 1 }],
      blockersChecked: ['X', 'Y'],
      version: t.version,
    });
  });

  it('trims the reason before storing it', async () => {
    const t = setup({});
    await t.service.delete(
      t.policy,
      ID,
      input({ reason: '   spaced   ' }),
      ACTOR,
    );
    expect(t.tombstones[0].reason).toBe('spaced');
  });

  it.each([
    ['a missing actor', undefined, 'unauthorised'],
    ['an actor that does not exist', ACTOR, 'noactor'],
  ])('refuses %s (401) before touching anything', async (_n, actor, kind) => {
    const t = setup({ actorExists: kind !== 'noactor' });
    const error = await errorOf(() =>
      t.service.delete(t.policy, ID, input(), actor as string),
    );

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
    expect(t.log).toEqual([]);
  });

  it.each([
    [
      'an unknown reason code',
      { reasonCode: 'BECAUSE' },
      DELETION_MESSAGE.REASON_CODE_UNKNOWN,
    ],
    ['an empty reason', { reason: '' }, DELETION_MESSAGE.REASON_REQUIRED],
    ['a blank reason', { reason: '   \n ' }, DELETION_MESSAGE.REASON_REQUIRED],
    [
      'a 501-character reason',
      { reason: 'x'.repeat(501) },
      DELETION_MESSAGE.REASON_TOO_LONG,
    ],
    [
      'a survivor with a reason other than Duplicate',
      { duplicateOfId: SURVIVOR },
      DELETION_MESSAGE.SURVIVOR_ONLY_FOR_DUPLICATE,
    ],
    [
      'a record named as its own survivor',
      { reasonCode: 'DUPLICATE', duplicateOfId: ID },
      DELETION_MESSAGE.SURVIVOR_IS_SELF,
    ],
  ])('refuses %s (400) and opens no transaction', async (_n, over, message) => {
    const t = setup({});
    const error = await errorOf(() =>
      t.service.delete(t.policy, ID, input(over), ACTOR),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(message);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts a reason of exactly 500 characters', async () => {
    const t = setup({});
    await t.service.delete(
      t.policy,
      ID,
      input({ reason: 'x'.repeat(500) }),
      ACTOR,
    );
    expect(t.tombstones[0].reason).toHaveLength(500);
  });

  it('is a 404 for a record that does not exist, and writes nothing', async () => {
    const t = setup({ existing: [] });
    const error = await errorOf(() =>
      t.service.delete(t.policy, ID, input(), ACTOR),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Lead not found.');
    expect(t.tombstones).toHaveLength(0);
    expect(t.log).not.toContain('remove');
  });

  it('is a 404 for a second deletion of the same record (it is already gone)', async () => {
    const t = setup({ evaluation: null, existing: [ID] });
    const error = await errorOf(() =>
      t.service.delete(t.policy, ID, input(), ACTOR),
    );
    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('refuses (409, DELETION_BLOCKED, with every blocker) when something stands in the way, under the lock', async () => {
    const blockers = [
      { code: 'A', message: 'It has 1 opportunity.', count: 1 },
      { code: 'B', message: '2 activities were logged on it.', count: 2 },
    ];
    const t = setup({ evaluation: { blockers } });
    const error = await errorOf(() =>
      t.service.delete(t.policy, ID, input(), ACTOR),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      message:
        "This lead can't be deleted: It has 1 opportunity. 2 activities were logged on it.",
      code: DELETION_CODE.BLOCKED,
      blockers,
    });
    expect(t.log).toEqual(['lock:' + ID, 'evaluate', 'rollback']);
    expect(t.tombstones).toHaveLength(0);
  });

  it('reports the blockers before a stale token, because they are the more useful answer', async () => {
    const t = setup({
      evaluation: { blockers: [{ code: 'A', message: 'm', count: 1 }] },
    });
    const error = await errorOf(() =>
      t.service.delete(t.policy, ID, input({ version: 'old' }), ACTOR),
    );
    expect(error.getResponse().code).toBe(DELETION_CODE.BLOCKED);
  });

  it('refuses (409, DELETION_STALE) when the record changed after the preview, and writes nothing', async () => {
    const t = setup({});
    const error = await errorOf(() =>
      t.service.delete(
        t.policy,
        ID,
        input({ version: versionOf({ a: 'older' }) }),
        ACTOR,
      ),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      message: DELETION_MESSAGE.STALE,
      code: DELETION_CODE.STALE,
    });
    expect(t.tombstones).toHaveLength(0);
    expect(t.log).not.toContain('remove');
  });

  describe('a duplicate with a surviving record', () => {
    it('locks both rows in one request, records the survivor on the tombstone and tells the survivor, before removing', async () => {
      const t = setup({});
      const result = await t.service.delete(
        t.policy,
        ID,
        input({
          reasonCode: 'DUPLICATE',
          reason: 'Same buyer, entered twice',
          duplicateOfId: SURVIVOR,
        }),
        ACTOR,
      );

      expect(t.log).toEqual([
        `lock:${ID},${SURVIVOR}`,
        'evaluate',
        'capture',
        'tombstone',
        'survivorEvent',
        'remove',
      ]);
      expect(t.tombstones[0]).toMatchObject({
        reasonCode: 'DUPLICATE',
        survivorId: SURVIVOR,
        survivorLabel: 'Survivor Ltd',
      });
      expect(result.survivorId).toBe(SURVIVOR);
      expect(t.policy.recordSurvivorEvent).toHaveBeenCalledWith(
        expect.anything(),
        {
          survivorId: SURVIVOR,
          removedId: ID,
          removedLabel: 'Sterling Pumps',
          actorId: ACTOR,
        },
      );
    });

    it('keeps the reason out of everything the policy writes into ordinary history: it is stored in the tombstone only', async () => {
      const SECRET = 'ZEBRA-CONFIDENTIAL-REASON';
      const t = setup({});
      await t.service.delete(
        t.policy,
        ID,
        input({
          reasonCode: 'DUPLICATE',
          reason: SECRET,
          duplicateOfId: SURVIVOR,
        }),
        ACTOR,
      );

      expect(t.tombstones[0]).toMatchObject({ reason: SECRET });
      for (const method of [
        'recordSurvivorEvent',
        'remove',
        'capture',
      ] as const) {
        const given = JSON.stringify(
          (t.policy[method] as jest.Mock).mock.calls.map((c: unknown[]) =>
            c.slice(1),
          ),
        );
        if (method === 'recordSurvivorEvent') {
          expect(given).not.toContain(SECRET);
          expect(given).not.toContain('reason');
        }
      }
    });

    it('is a 400 when the survivor does not exist (or was just deleted), and nothing is written', async () => {
      const t = setup({ existing: [ID] });
      const error = await errorOf(() =>
        t.service.delete(
          t.policy,
          ID,
          input({ reasonCode: 'DUPLICATE', duplicateOfId: SURVIVOR }),
          ACTOR,
        ),
      );

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(
        'The surviving lead was not found. It may have been deleted.',
      );
      expect(t.tombstones).toHaveLength(0);
    });

    it('does not write a survivor event for a reason other than Duplicate', async () => {
      const t = setup({});
      await t.service.delete(t.policy, ID, input(), ACTOR);
      expect(t.policy.recordSurvivorEvent).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    it('rolls the tombstone back when the removal fails', async () => {
      const t = setup({ removeError: new Error('disk on fire') });
      const error = await errorOf(() =>
        t.service.delete(t.policy, ID, input(), ACTOR),
      );

      expect(error.message).toBe('disk on fire');
      expect(t.log).toEqual([
        'lock:' + ID,
        'evaluate',
        'capture',
        'tombstone',
        'remove',
        'rollback',
      ]);
      expect(t.tombstones).toHaveLength(0);
      expect(t.committed()).toBe(false);
    });

    it('rolls back when the survivor event fails, before anything is removed', async () => {
      const t = setup({});
      (t.policy.recordSurvivorEvent as jest.Mock).mockRejectedValueOnce(
        new Error('timeline down'),
      );
      const error = await errorOf(() =>
        t.service.delete(
          t.policy,
          ID,
          input({ reasonCode: 'DUPLICATE', duplicateOfId: SURVIVOR }),
          ACTOR,
        ),
      );

      expect(error.message).toBe('timeline down');
      expect(t.log).not.toContain('remove');
      expect(t.tombstones).toHaveLength(0);
    });

    it('turns a foreign-key refusal (the backstop) into a 409 refusal, with nothing deleted', async () => {
      const fk = new Prisma.PrismaClientKnownRequestError('FK', {
        code: 'P2003',
        clientVersion: 'x',
      });
      const t = setup({ removeError: fk });
      const error = await errorOf(() =>
        t.service.delete(t.policy, ID, input(), ACTOR),
      );

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().code).toBe(DELETION_CODE.BLOCKED);
      expect(error.getResponse().message).toContain('Nothing was deleted.');
      expect(t.tombstones).toHaveLength(0);
    });

    it('lets any other database error through unchanged (a 500, rolled back)', async () => {
      const other = new Prisma.PrismaClientKnownRequestError('x', {
        code: 'P2025',
        clientVersion: 'x',
      });
      const t = setup({ removeError: other });
      const error = await errorOf(() =>
        t.service.delete(t.policy, ID, input(), ACTOR),
      );
      expect(error).toBe(other);
      expect(t.tombstones).toHaveLength(0);
    });
  });
});

describe('DataDeletionService.preview', () => {
  it('says what is in the way, what would go, what stays, and the token; and changes nothing', async () => {
    const t = setup({
      evaluation: {
        blockers: [{ code: 'A', message: 'It has 1 opportunity.', count: 1 }],
      },
    });
    t.prisma.$transaction = jest.fn(async (fn: any) => fn({}));

    const preview = await t.service.preview(t.policy, ID);

    expect(preview).toMatchObject({
      entityType: 'LEAD',
      entityId: ID,
      label: 'Sterling Pumps',
      code: 'L-1',
      eligible: false,
      version: t.version,
    });
    expect(preview.blockers).toHaveLength(1);
    expect(preview.keeps[0]).toContain('Recycle Bin');
    expect(preview.keeps[1]).toContain('Deletion Log');
    expect(preview.recoveryDays).toBe(30);
    expect(preview.reasonCodes).toEqual([
      'DUPLICATE',
      'ENTERED_IN_ERROR',
      'TEST_DATA',
      'JUNK_OR_SPAM',
      'OTHER',
    ]);
    expect(t.policy.lockRows).not.toHaveBeenCalled();
    expect(t.policy.remove).not.toHaveBeenCalled();
  });

  it('is eligible when nothing stands in the way', async () => {
    const t = setup({});
    t.prisma.$transaction = jest.fn(async (fn: any) => fn({}));
    expect((await t.service.preview(t.policy, ID)).eligible).toBe(true);
  });

  it('is a 404 for a record that does not exist', async () => {
    const t = setup({ evaluation: null });
    t.prisma.$transaction = jest.fn(async (fn: any) => fn({}));
    expect(await errorOf(() => t.service.preview(t.policy, ID))).toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('versionOf', () => {
  it('is the same for the same facts in any order, and differs when any fact differs', () => {
    expect(versionOf({ a: 1, b: 2 })).toBe(versionOf({ b: 2, a: 1 }));
    expect(versionOf({ a: 1, b: 2 })).not.toBe(versionOf({ a: 1, b: 3 }));
    expect(versionOf({ a: 1 })).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ---------------------------------------------------------------------------------------
// Restore, purge and the recovery window
// ---------------------------------------------------------------------------------------

const RID = '00000000-0000-4000-8000-0000000000c1';
const DELETED_AT = new Date('2026-10-01T09:00:00.000Z');
const PURGE_AFTER = new Date('2026-10-31T09:00:00.000Z');

function setupRestore(options: {
  status?: string;
  now?: Date;
  conflicts?: Array<{ code: string; message: string }>;
  facts?: Record<string, unknown>;
  survivorId?: string | null;
  restoreError?: unknown;
  missing?: boolean;
  // somebody else holds the row lock: SELECT ... FOR UPDATE SKIP LOCKED returns nothing
  locked?: boolean;
  // the update fails (the database refused it)
  updateError?: unknown;
}) {
  const log: string[] = [];
  let record: any = {
    id: RID,
    entityType: 'LEAD',
    entityId: ID,
    entityCode: null,
    entityLabel: 'Sterling Pumps',
    reasonCode: 'ENTERED_IN_ERROR',
    reason: 'Typed twice',
    survivorId: options.survivorId ?? null,
    survivorLabel: options.survivorId ? 'Survivor' : null,
    snapshot: { lead: { id: ID } },
    impact: {},
    status: options.status ?? 'DELETED',
    deletedAt: DELETED_AT,
    purgeAfter: PURGE_AFTER,
    deletedBy: { id: 'u', fullName: 'U' },
  };
  const policy: any = {
    entityType: 'LEAD',
    noun: 'lead',
    notFoundMessage: 'Lead not found.',
    restoreEvaluate: jest.fn(async () => {
      log.push('evaluate');
      return {
        conflicts: options.conflicts ?? [],
        restores: [{ label: 'The lead record', count: 1 }],
        facts: options.facts ?? { n: 1 },
      };
    }),
    lockForRestore: jest.fn(async () => {
      log.push('lockForRestore');
    }),
    restore: jest.fn(async () => {
      log.push('restore');
      if (options.restoreError) throw options.restoreError;
    }),
    recordSurvivorRestored: jest.fn(async () => {
      log.push('survivorRestored');
    }),
    redactSurvivorEvents: jest.fn(async () => {
      log.push('redactSurvivor');
    }),
  };
  (policyFor as jest.Mock).mockReturnValue(policy);
  const updates: any[] = [];
  const tx: any = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const skip = strings.join('?').includes('SKIP LOCKED');
      log.push(skip ? 'lockSkipLocked' : 'lockTombstone');
      if (options.missing) return [];
      if (skip && options.locked) return [];
      return [{ id: RID }];
    }),
    dataDeletionRecord: {
      count: jest.fn(async () => (options.missing ? 0 : 1)),
      findUnique: jest.fn(async () => (options.missing ? null : record)),
      findUniqueOrThrow: jest.fn(async () => record),
      updateMany: jest.fn(async (args: any) => {
        if (options.updateError) throw options.updateError;
        if (record.status !== args.where.status) return { count: 0 };
        log.push('finish');
        updates.push(args.data);
        record = { ...record, ...args.data };
        return { count: 1 };
      }),
      update: jest.fn(async (args: any) => {
        log.push('finish');
        updates.push(args.data);
        record = { ...record, ...args.data };
        return record;
      }),
    },
  };
  const prisma: any = {
    user: { findUnique: jest.fn(async () => ({ id: ACTOR })) },
    dataDeletionRecord: {
      findMany: jest.fn(async () => [record]),
      findUnique: jest.fn(async () => (options.missing ? null : record)),
    },
    $transaction: jest.fn(async (fn: any) => {
      const saved = record;
      try {
        return await fn(tx);
      } catch (error) {
        log.push('rollback');
        updates.length = 0;
        record = saved;
        throw error;
      }
    }),
  };
  const service = new DataDeletionService(
    prisma,
    () => options.now ?? new Date('2026-10-05T09:00:00.000Z'),
  );

  return { service, policy, log, updates, tx, prisma, record: () => record };
}

// What a purge leaves in a tombstone (the lifecycle trigger and the CHECKs require exactly this).
const ERASED = {
  snapshot: { purged: true },
  impact: {},
  entityId: null,
  entityCode: null,
  entityLabel: null,
  reason: null,
  survivorId: null,
  survivorLabel: null,
  deletedById: null,
};

const previewVersion = async (t: ReturnType<typeof setupRestore>) =>
  (await t.service.restorePreview(RID)).version;

describe('DataDeletionService.restorePreview', () => {
  it('is eligible inside the window with no conflicts, and says what it would put back', async () => {
    const t = setupRestore({});
    const preview = await t.service.restorePreview(RID);

    expect(preview).toMatchObject({
      id: RID,
      entityType: 'LEAD',
      entityId: ID,
      label: 'Sterling Pumps',
      status: 'DELETED',
      expired: false,
      eligible: true,
      conflicts: [],
    });
    expect(preview.purgeAfter).toEqual(PURGE_AFTER);
    expect(preview.restores).toEqual([{ label: 'The lead record', count: 1 }]);
    expect(preview.version).toMatch(/^[0-9a-f]{32}$/);
  });

  it('lists every conflict and is not eligible', async () => {
    const t = setupRestore({
      conflicts: [
        { code: 'A', message: 'Its lead code is used.' },
        { code: 'B', message: 'Its source is gone.' },
      ],
    });
    const preview = await t.service.restorePreview(RID);
    expect(preview.eligible).toBe(false);
    expect(preview.conflicts.map((c) => c.code)).toEqual(['A', 'B']);
  });

  it('after the recovery window it is not eligible, and says so first', async () => {
    const t = setupRestore({ now: new Date('2026-10-31T09:00:00.001Z') });
    const preview = await t.service.restorePreview(RID);
    expect(preview.expired).toBe(true);
    expect(preview.eligible).toBe(false);
    expect(preview.conflicts[0].code).toBe(
      DELETION_CODE.RESTORE_WINDOW_EXPIRED,
    );
  });

  it('is still inside the window at the very last millisecond', async () => {
    const t = setupRestore({ now: PURGE_AFTER });
    expect((await t.service.restorePreview(RID)).expired).toBe(false);
  });

  it.each([
    ['RESTORED', DELETION_CODE.ALREADY_RESTORED],
    ['PURGED', DELETION_CODE.ALREADY_PURGED],
  ])(
    'a %s record is not eligible (%s) and its snapshot is not read',
    async (status, code) => {
      const t = setupRestore({ status });
      const preview = await t.service.restorePreview(RID);
      expect(preview.eligible).toBe(false);
      expect(preview.conflicts[0].code).toBe(code);
      expect(t.policy.restoreEvaluate).not.toHaveBeenCalled();
    },
  );

  it('is a 404 for an unknown record', async () => {
    expect(
      await errorOf(() =>
        setupRestore({ missing: true }).service.restorePreview(RID),
      ),
    ).toBeInstanceOf(NotFoundException);
  });

  it('changes when a fact the decision rests on changes', async () => {
    const a = await previewVersion(setupRestore({ facts: { n: 1 } }));
    const b = await previewVersion(setupRestore({ facts: { n: 2 } }));
    const c = await previewVersion(
      setupRestore({ conflicts: [{ code: 'X', message: 'm' }] }),
    );
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('DataDeletionService.restore', () => {
  it('locks the tombstone, locks and re-checks, restores, then finishes the tombstone, in that order', async () => {
    const t = setupRestore({});
    const result = await t.service.restore(
      RID,
      { version: await previewVersion(t) },
      ACTOR,
    );

    expect(t.log.filter((l) => l !== 'evaluate').slice(0, 5)).toEqual([
      'lockTombstone',
      'lockForRestore',
      'restore',
      'finish',
    ]);
    expect(t.log).toContain('evaluate');
    expect(result).toMatchObject({
      id: RID,
      entityType: 'LEAD',
      entityId: ID,
      label: 'Sterling Pumps',
    });
    expect(t.updates[0]).toMatchObject({
      status: 'RESTORED',
      restoredById: ACTOR,
    });
    expect(t.updates[0].restoredAt).toEqual(
      new Date('2026-10-05T09:00:00.000Z'),
    );
    expect(t.policy.restore).toHaveBeenCalledWith(
      expect.anything(),
      { lead: { id: ID } },
      expect.objectContaining({
        recordId: RID,
        actorId: ACTOR,
      }),
    );
    // exactly these three: the reason is not handed to the policy that writes the history event
    const context = (t.policy.restore as jest.Mock).mock.calls[0][2] as object;
    expect(Object.keys(context).sort()).toEqual(['actorId', 'now', 'recordId']);
    expect(JSON.stringify(context)).not.toContain('Typed twice');
  });

  it('refuses with every conflict (409 RESTORE_BLOCKED) and restores nothing', async () => {
    const conflicts = [{ code: 'A', message: 'Its lead code is used.' }];
    const t = setupRestore({ conflicts });
    const error = await errorOf(() =>
      t.service.restore(RID, { version: 'whatever' }, ACTOR),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({
      message: "This lead can't be restored: Its lead code is used.",
      code: DELETION_CODE.RESTORE_BLOCKED,
      conflicts,
    });
    expect(t.policy.restore).not.toHaveBeenCalled();
    expect(t.updates).toHaveLength(0);
  });

  it('refuses a stale token (409 RESTORE_STALE) and restores nothing', async () => {
    const t = setupRestore({});
    const error = await errorOf(() =>
      t.service.restore(RID, { version: 'old-token' }, ACTOR),
    );
    expect(error.getResponse()).toEqual({
      message: DELETION_MESSAGE.RESTORE_STALE,
      code: DELETION_CODE.RESTORE_STALE,
    });
    expect(t.policy.restore).not.toHaveBeenCalled();
  });

  it('refuses after the recovery window (409) even with a perfect token', async () => {
    const t = setupRestore({ now: new Date('2026-11-01T00:00:00.000Z') });
    const error = await errorOf(() =>
      t.service.restore(RID, { version: 'x' }, ACTOR),
    );
    expect(error.getResponse().code).toBe(DELETION_CODE.RESTORE_WINDOW_EXPIRED);
    expect(t.policy.lockForRestore).not.toHaveBeenCalled();
  });

  it.each([
    ['RESTORED', DELETION_CODE.ALREADY_RESTORED],
    ['PURGED', DELETION_CODE.ALREADY_PURGED],
  ])('restoring a %s record again is a 409 %s', async (status, code) => {
    const t = setupRestore({ status });
    const error = await errorOf(() =>
      t.service.restore(RID, { version: 'x' }, ACTOR),
    );
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().code).toBe(code);
    expect(t.policy.restore).not.toHaveBeenCalled();
  });

  it('is a 404 for an unknown record, and a 401 without a user', async () => {
    expect(
      await errorOf(() =>
        setupRestore({ missing: true }).service.restore(
          RID,
          { version: 'x' },
          ACTOR,
        ),
      ),
    ).toBeInstanceOf(NotFoundException);
    const t = setupRestore({});
    expect(
      await errorOf(() => t.service.restore(RID, { version: 'x' }, undefined)),
    ).toBeInstanceOf(UnauthorizedException);
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('tells the survivor of a duplicate that it is back', async () => {
    const t = setupRestore({ survivorId: SURVIVOR });
    await t.service.restore(RID, { version: await previewVersion(t) }, ACTOR);
    expect(t.policy.recordSurvivorRestored).toHaveBeenCalledWith(
      expect.anything(),
      {
        survivorId: SURVIVOR,
        restoredId: ID,
        restoredLabel: 'Sterling Pumps',
        actorId: ACTOR,
      },
    );
    expect(t.log.indexOf('survivorRestored')).toBeLessThan(
      t.log.indexOf('finish'),
    );
  });

  it('does not tell anyone when there was no survivor', async () => {
    const t = setupRestore({});
    await t.service.restore(RID, { version: await previewVersion(t) }, ACTOR);
    expect(t.policy.recordSurvivorRestored).not.toHaveBeenCalled();
  });

  it('rolls everything back when the restore fails, and leaves the tombstone DELETED', async () => {
    const t = setupRestore({ restoreError: new Error('disk on fire') });
    const error = await errorOf(async () =>
      t.service.restore(RID, { version: await previewVersion(t) }, ACTOR),
    );
    expect(error.message).toBe('disk on fire');
    expect(t.log).toContain('rollback');
    expect(t.log).not.toContain('finish');
    expect(t.record().status).toBe('DELETED');
  });

  it.each(['P2002', 'P2003'])(
    'turns a unique-index or foreign-key refusal (%s) into a 409 RESTORE_BLOCKED, never a 500',
    async (code) => {
      const t = setupRestore({
        restoreError: new Prisma.PrismaClientKnownRequestError('x', {
          code,
          clientVersion: 'x',
        }),
      });
      const error = await errorOf(async () =>
        t.service.restore(RID, { version: await previewVersion(t) }, ACTOR),
      );
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse().code).toBe(DELETION_CODE.RESTORE_BLOCKED);
      expect(error.getResponse().message).toContain('Nothing was restored.');
      expect(t.log).not.toContain('finish');
    },
  );
});

describe('DataDeletionService.purge (by hand, by an administrator)', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it.each([
    ['well inside the window', new Date('2026-10-05T00:00:00.000Z')],
    [
      'one millisecond before the deadline',
      new Date(PURGE_AFTER.getTime() - 1),
    ],
    ['at the deadline itself', PURGE_AFTER],
    ['one millisecond after the deadline', new Date(PURGE_AFTER.getTime() + 1)],
    ['long after', new Date(PURGE_AFTER.getTime() + 90 * DAY)],
  ])(
    'erases it %s: PURGED, MANUAL, who and when, snapshot replaced by the marker',
    async (_when, now) => {
      const t = setupRestore({ now });
      const result = await t.service.purge(RID, ACTOR);

      expect(result).toMatchObject({
        id: RID,
        entityType: 'LEAD',
        purgeMethod: 'MANUAL',
      });
      // nothing that identifies the record comes back: no name, and no original id, in the answer
      expect(result).not.toHaveProperty('label');
      expect(result).not.toHaveProperty('entityId');
      expect(JSON.stringify(result)).not.toContain('Sterling');
      expect(JSON.stringify(result)).not.toContain(ID);
      expect(t.updates).toEqual([
        {
          status: 'PURGED',
          purgedAt: now,
          purgedById: ACTOR,
          purgeMethod: 'MANUAL',
          ...ERASED,
        },
      ]);
    },
  );

  it.each([
    [
      'manual',
      (t: ReturnType<typeof setupRestore>) => t.service.purge(RID, ACTOR),
    ],
    [
      'automatic',
      (t: ReturnType<typeof setupRestore>) => t.service.purgeExpired(RID),
    ],
  ])(
    '%s purge: everything that only served recovery is erased in the one update, and the minimal audit stays',
    async (_how, purge) => {
      const t = setupRestore({
        now: new Date(PURGE_AFTER.getTime() + 1),
        survivorId: SURVIVOR,
      });
      const before = { ...t.record() };
      expect(before.entityLabel).toBe('Sterling Pumps');
      expect(before.reason).toBe('Typed twice');
      await purge(t);

      const after = t.record();
      // erased
      expect(after).toMatchObject(ERASED);
      expect(JSON.stringify(after)).not.toMatch(
        /Sterling|Typed twice|Survivor/,
      );
      // the original id of the lead is gone too: nothing points back to it
      expect(after.entityId).toBeNull();
      expect(JSON.stringify(after)).not.toContain(ID);
      // kept: the tombstone's own id, the kind, the category, the timing
      expect(after).toMatchObject({
        id: RID,
        entityType: 'LEAD',
        reasonCode: before.reasonCode,
        deletedAt: DELETED_AT,
        purgeAfter: PURGE_AFTER,
        status: 'PURGED',
      });
    },
  );

  it.each([
    [
      'manual',
      (t: ReturnType<typeof setupRestore>) => t.service.purge(RID, ACTOR),
    ],
    [
      'automatic',
      (t: ReturnType<typeof setupRestore>) => t.service.purgeExpired(RID),
    ],
  ])(
    "%s purge of a duplicate scrubs the surviving record's history of the erased name (after the update, in the same transaction); with no survivor nothing is scrubbed",
    async (_how, purge) => {
      const now = new Date(PURGE_AFTER.getTime() + 1);
      const withSurvivor = setupRestore({ now, survivorId: SURVIVOR });
      await purge(withSurvivor);
      expect(withSurvivor.policy.redactSurvivorEvents).toHaveBeenCalledTimes(1);
      expect(withSurvivor.policy.redactSurvivorEvents).toHaveBeenCalledWith(
        expect.anything(),
        { survivorId: SURVIVOR, removedLabel: 'Sterling Pumps' },
      );
      expect(withSurvivor.log).toEqual(
        expect.arrayContaining(['finish', 'redactSurvivor']),
      );
      expect(withSurvivor.log.indexOf('redactSurvivor')).toBeGreaterThan(
        withSurvivor.log.indexOf('finish'),
      );

      const alone = setupRestore({ now });
      await purge(alone);
      expect(alone.policy.redactSurvivorEvents).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'manual',
      (t: ReturnType<typeof setupRestore>) => t.service.purge(RID, ACTOR),
    ],
    [
      'automatic',
      (t: ReturnType<typeof setupRestore>) => t.service.purgeExpired(RID),
    ],
  ])(
    '%s purge: if scrubbing the survivor fails, nothing is purged: the whole transaction rolls back and the copy is intact',
    async (_how, purge) => {
      const t = setupRestore({
        now: new Date(PURGE_AFTER.getTime() + 1),
        survivorId: SURVIVOR,
      });
      const boom = new Error('history table unavailable');
      (t.policy.redactSurvivorEvents as jest.Mock).mockRejectedValueOnce(boom);
      expect(await errorOf(() => purge(t))).toBe(boom);
      expect(t.log).toContain('rollback');
      expect(t.record().status).toBe('DELETED');
      expect(t.record().entityLabel).toBe('Sterling Pumps');
      expect(t.record().reason).toBe('Typed twice');
      expect(t.record().snapshot).toEqual({ lead: { id: ID } });
    },
  );

  it('a record already purged is not scrubbed or erased again', async () => {
    const t = setupRestore({
      now: new Date(PURGE_AFTER.getTime() + 1),
      survivorId: SURVIVOR,
    });
    await t.service.purge(RID, ACTOR);
    await errorOf(() => t.service.purge(RID, ACTOR));
    expect(await t.service.purgeExpired(RID)).toBe('NOT_DELETED');
    expect(t.policy.redactSurvivorEvents).toHaveBeenCalledTimes(1);
  });

  it('takes the row lock first and only moves a row that is still DELETED', async () => {
    const t = setupRestore({});
    await t.service.purge(RID, ACTOR);
    expect(t.log.slice(0, 2)).toEqual(['lockTombstone', 'finish']);
    expect(t.tx.dataDeletionRecord.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: RID, status: 'DELETED' } }),
    );
  });

  it('there is no too-early refusal any more', () => {
    expect(Object.keys(DELETION_CODE)).not.toContain('PURGE_TOO_EARLY');
  });

  it.each([
    ['PURGED', DELETION_CODE.ALREADY_PURGED],
    ['RESTORED', DELETION_CODE.ALREADY_RESTORED],
  ])('a %s record cannot be purged (%s)', async (status, code) => {
    const t = setupRestore({
      status,
      now: new Date('2027-01-01T00:00:00.000Z'),
    });
    const error = await errorOf(() => t.service.purge(RID, ACTOR));
    expect(error.getResponse().code).toBe(code);
    expect(t.updates).toHaveLength(0);
  });

  it('a second purge of the same record is refused (409), the first stands', async () => {
    const t = setupRestore({});
    await t.service.purge(RID, ACTOR);
    const first = { ...t.record() };
    const error = await errorOf(() => t.service.purge(RID, 'user-2'));
    expect(error.getResponse().code).toBe(DELETION_CODE.ALREADY_PURGED);
    expect(t.record()).toEqual(first);
    expect(t.record().purgedById).toBe(ACTOR);
  });

  it('is a 404 for an unknown record and a 401 without a user', async () => {
    expect(
      await errorOf(() =>
        setupRestore({ missing: true }).service.purge(RID, ACTOR),
      ),
    ).toBeInstanceOf(NotFoundException);
    expect(
      await errorOf(() => setupRestore({}).service.purge(RID, undefined)),
    ).toBeInstanceOf(UnauthorizedException);
  });

  it('does not mark the record purged when the update fails: the transaction rolls back and the error surfaces', async () => {
    const boom = new Error('refused by the database');
    const t = setupRestore({ updateError: boom });
    expect(await errorOf(() => t.service.purge(RID, ACTOR))).toBe(boom);
    expect(t.log).toContain('rollback');
    expect(t.record().status).toBe('DELETED');
  });
});

describe('DataDeletionService.purgeExpired (the purge worker, one record)', () => {
  const MS = 1;

  it.each([
    ['well before the deadline', new Date('2026-10-05T00:00:00.000Z')],
    [
      'one millisecond before the deadline',
      new Date(PURGE_AFTER.getTime() - MS),
    ],
    ['exactly at the stored deadline (still inside the window)', PURGE_AFTER],
  ])('does nothing %s (NOT_DUE)', async (_when, now) => {
    const t = setupRestore({ now });
    expect(await t.service.purgeExpired(RID)).toBe('NOT_DUE');
    expect(t.updates).toHaveLength(0);
    expect(t.record().status).toBe('DELETED');
  });

  it.each([
    [
      'one millisecond after the deadline',
      new Date(PURGE_AFTER.getTime() + MS),
    ],
    ['a day after', new Date(PURGE_AFTER.getTime() + 24 * 60 * 60 * 1000)],
    [
      'a year after',
      new Date(PURGE_AFTER.getTime() + 365 * 24 * 60 * 60 * 1000),
    ],
  ])(
    'purges it %s: PURGED, AUTOMATIC, no actor, the marker snapshot',
    async (_when, now) => {
      const t = setupRestore({ now });
      expect(await t.service.purgeExpired(RID)).toBe('PURGED');
      expect(t.updates).toEqual([
        {
          status: 'PURGED',
          purgedAt: now,
          purgedById: null,
          purgeMethod: 'AUTOMATIC',
          ...ERASED,
        },
      ]);
    },
  );

  it('judges by the STORED deadline, not by a window recalculated now: a record whose stored deadline is later is not due', async () => {
    const now = new Date('2026-11-15T00:00:00.000Z'); // 15 days after the default deadline
    const t = setupRestore({ now });
    t.record().purgeAfter = new Date('2027-03-01T00:00:00.000Z');
    expect(await t.service.purgeExpired(RID)).toBe('NOT_DUE');
    expect(t.updates).toHaveLength(0);
  });

  it('takes the row lock with SKIP LOCKED before it looks at anything', async () => {
    const t = setupRestore({ now: new Date('2027-01-01T00:00:00.000Z') });
    await t.service.purgeExpired(RID);
    expect(t.log[0]).toBe('lockSkipLocked');
  });

  it('leaves a record somebody else holds (a restore, a manual purge, another worker): LOCKED, nothing written', async () => {
    const t = setupRestore({
      now: new Date('2027-01-01T00:00:00.000Z'),
      locked: true,
    });
    expect(await t.service.purgeExpired(RID)).toBe('LOCKED');
    expect(t.updates).toHaveLength(0);
  });

  it.each(['RESTORED', 'PURGED'])(
    'never touches a %s record (NOT_DELETED): a record restored first is not purged',
    async (status) => {
      const t = setupRestore({
        status,
        now: new Date('2027-01-01T00:00:00.000Z'),
      });
      expect(await t.service.purgeExpired(RID)).toBe('NOT_DELETED');
      expect(t.updates).toHaveLength(0);
      expect(t.record().status).toBe(status);
    },
  );

  it('a record that no longer exists is nothing to do (NOT_DELETED), not an error', async () => {
    const t = setupRestore({
      missing: true,
      now: new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(await t.service.purgeExpired(RID)).toBe('NOT_DELETED');
  });

  it('is idempotent: the second call finds it PURGED and does nothing', async () => {
    const t = setupRestore({ now: new Date('2027-01-01T00:00:00.000Z') });
    expect(await t.service.purgeExpired(RID)).toBe('PURGED');
    expect(await t.service.purgeExpired(RID)).toBe('NOT_DELETED');
    expect(t.updates).toHaveLength(1);
  });

  it('a failed update throws, rolls back, and leaves the record DELETED to be found again', async () => {
    const boom = Object.assign(new Error('refused'), { code: 'P2034' });
    const t = setupRestore({
      now: new Date('2027-01-01T00:00:00.000Z'),
      updateError: boom,
    });
    expect(await errorOf(() => t.service.purgeExpired(RID))).toBe(boom);
    expect(t.log).toContain('rollback');
    expect(t.record().status).toBe('DELETED');
    expect(t.record().purgeMethod).toBeUndefined();
  });

  it('after a restore the worker leaves the record restored, however long after the deadline', async () => {
    const t = setupRestore({ now: new Date('2026-10-30T00:00:00.000Z') });
    await t.service.restore(RID, { version: await previewVersion(t) }, ACTOR);
    expect(t.record().status).toBe('RESTORED');
    const later = new Date('2027-06-01T00:00:00.000Z');
    const worker = new DataDeletionService(t.prisma, () => later);
    expect(await worker.purgeExpired(RID)).toBe('NOT_DELETED');
    expect(t.record().status).toBe('RESTORED');
  });
});

describe('DataDeletionService.findExpiredTombstones (a page for the worker)', () => {
  const NOW = new Date('2026-12-01T00:00:00.000Z');

  const find = async (
    limit: number,
    after?: { purgeAfter: Date; id: string },
  ) => {
    const t = setupRestore({ now: NOW });
    await t.service.findExpiredTombstones(limit, after);
    return t.prisma.dataDeletionRecord.findMany.mock.calls[0][0];
  };

  it('asks only for DELETED tombstones strictly past their STORED deadline, oldest deadline first, at most `limit`', async () => {
    const q = await find(50);
    expect(q.where).toEqual({ status: 'DELETED', purgeAfter: { lt: NOW } });
    expect(q.orderBy).toEqual([{ purgeAfter: 'asc' }, { id: 'asc' }]);
    expect(q.take).toBe(50);
    expect(q.select).toEqual({ id: true, entityType: true, purgeAfter: true });
  });

  it('continues after a position (keyset on deadline then id): no offset, so a page is never skipped or repeated', async () => {
    const after = { purgeAfter: PURGE_AFTER, id: 'abc' };
    const q = await find(10, after);
    expect(q.where.OR).toEqual([
      { purgeAfter: { gt: PURGE_AFTER } },
      { purgeAfter: PURGE_AFTER, id: { gt: 'abc' } },
    ]);
    expect(q.skip).toBeUndefined();
  });
});

describe('DataDeletionService.list', () => {
  it('judges "recoverable" now: DELETED and inside the window; the snapshot never leaves', async () => {
    const t = setupRestore({ now: new Date('2026-10-05T00:00:00.000Z') });
    const [row] = await t.service.list({});
    expect(row.recoverable).toBe(true);
    expect(row.expired).toBe(false);
    expect(
      t.prisma.dataDeletionRecord.findMany.mock.calls[0][0].select,
    ).not.toHaveProperty('snapshot');

    const late = setupRestore({ now: new Date('2026-11-05T00:00:00.000Z') });
    const [lateRow] = await late.service.list({});
    expect(lateRow.recoverable).toBe(false);
    expect(lateRow.expired).toBe(true);

    const restored = setupRestore({ status: 'RESTORED' });
    expect((await restored.service.list({}))[0].recoverable).toBe(false);
  });

  it('filters by status, entity type and entity id', async () => {
    const t = setupRestore({});
    await t.service.list({
      entityType: 'CUSTOMER',
      status: 'RESTORED',
      entityId: 'x',
      limit: 5,
      offset: 10,
    });
    expect(t.prisma.dataDeletionRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityType: 'CUSTOMER', status: 'RESTORED', entityId: 'x' },
        take: 5,
        skip: 10,
      }),
    );
  });
});
