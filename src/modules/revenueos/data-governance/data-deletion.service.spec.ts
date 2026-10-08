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

// The shared deletion rules, with a policy double: what the service itself guarantees,
// whatever kind of record it is deleting. (The lead's own rules are in
// lead-deletion.policy.spec.ts; the real database, the locks and the races are proven
// on a scratch database.)

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
  };

  const tx = {
    dataDeletionRecord: {
      create: jest.fn(async (args: any) => {
        log.push('tombstone');
        tombstones.push(args.data);
        return { id: 'ts-1', deletedAt: new Date('2026-10-11T10:00:00Z') };
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
    service: new DataDeletionService(prisma),
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
          reasonCode: 'DUPLICATE',
          reason: 'Same buyer, entered twice',
          actorId: ACTOR,
        },
      );
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
    expect(preview.keeps[0]).toContain('Deletion Log');
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
