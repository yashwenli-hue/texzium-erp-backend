/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import {
  LEAD_DELETION_POLICY,
  LEAD_RESTORE_CONFLICT,
} from './lead-deletion.policy';

// Restoring a lead from its snapshot: what is checked before anything is recreated, what
// is written, with which ids and dates, and what is left out. (Against a real database,
// with the locks and the races, it is proven on a scratch database.)

const snapshot = () => ({
  schemaVersion: 1,
  lead: {
    id: 'L1',
    leadCode: 'LD-7',
    customerName: 'Sterling Pumps',
    companyName: null,
    email: 'a@b.co',
    phone: '9822041120',
    alternatePhone: null,
    sourceId: 'S1',
    assignedToId: 'U1',
    country: 'IN',
    state: 'Goa',
    city: null,
    status: 'NEW',
    isActive: false,
    deactivatedAt: '2026-09-02T00:00:00.000Z',
    deactivatedById: 'U2',
    deactivationReason: 'junk',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-03T00:00:00.000Z',
    source: { id: 'S1', name: 'Web' },
  },
  timelines: [
    {
      id: 'T1',
      leadId: 'L1',
      action: 'LEAD_CREATED',
      remarks: null,
      userRemark: null,
      source: 'SYSTEM',
      activityType: null,
      actorId: null,
      occurredAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:01.000Z',
      surprise: 'x',
    },
    {
      id: 'T2',
      leadId: 'L1',
      action: 'LEAD_DEACTIVATED',
      remarks: 'junk',
      userRemark: null,
      source: 'SYSTEM',
      activityType: null,
      actorId: 'U2',
      occurredAt: '2026-09-02T00:00:00.000Z',
      createdAt: '2026-09-02T00:00:00.000Z',
    },
  ],
  notes: [
    {
      id: 'N1',
      leadId: 'L1',
      note: 'Needs pumps',
      createdAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  followups: [
    {
      id: 'F1',
      leadId: 'L1',
      followupDate: '2026-09-05T00:00:00.000Z',
      remarks: null,
      status: 'CANCELLED',
      completedAt: null,
      completedById: null,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    },
  ],
  people: [],
});

function dbFor(
  over: {
    leadExists?: boolean;
    codeTakenBy?: string | null;
    sourceExists?: boolean;
    users?: string[];
    clash?: number;
  } = {},
) {
  return {
    lead: {
      findUnique: jest.fn(async (args: any) => {
        if (args.where.leadCode)
          return over.codeTakenBy ? { customerName: over.codeTakenBy } : null;
        return over.leadExists ? { id: 'L1' } : null;
      }),
    },
    leadSource: {
      findUnique: jest.fn(async () =>
        over.sourceExists === false ? null : { id: 'S1' },
      ),
    },
    user: {
      findMany: jest.fn(async (args: any) =>
        (over.users ?? ['U1', 'U2'])
          .filter((id) => args.where.id.in.includes(id))
          .map((id) => ({ id })),
      ),
    },
    leadTimeline: { count: jest.fn(async () => over.clash ?? 0) },
    leadNote: { count: jest.fn(async () => 0) },
    leadFollowup: { count: jest.fn(async () => 0) },
  } as any;
}

const evaluate = (over = {}, snap: unknown = snapshot()) =>
  LEAD_DELETION_POLICY.restoreEvaluate(dbFor(over), snap, { entityId: 'L1' });
const codes = async (over = {}, snap: unknown = snapshot()) =>
  (await evaluate(over, snap)).conflicts.map((c) => c.code);

describe('lead restore: conflicts, checked before anything is recreated', () => {
  it('has none when nothing has changed, and says what it would put back', async () => {
    const result = await evaluate();
    expect(result.conflicts).toEqual([]);
    expect(result.restores).toEqual([
      { label: 'The lead record', count: 1 },
      { label: 'History events', count: 2 },
      { label: 'Imported notes', count: 1 },
      { label: 'Cancelled follow-ups', count: 1 },
    ]);
  });

  it.each([
    [
      'a lead with the same identity exists',
      { leadExists: true },
      LEAD_RESTORE_CONFLICT.ID_EXISTS,
    ],
    [
      'its lead code is used by another lead',
      { codeTakenBy: 'Acme' },
      LEAD_RESTORE_CONFLICT.CODE_TAKEN,
    ],
    [
      'its lead source is gone',
      { sourceExists: false },
      LEAD_RESTORE_CONFLICT.SOURCE_MISSING,
    ],
    [
      'a person named in its history is gone',
      { users: ['U1'] },
      LEAD_RESTORE_CONFLICT.USER_MISSING,
    ],
    [
      'a piece of its history already exists',
      { clash: 1 },
      LEAD_RESTORE_CONFLICT.CHILD_ID_EXISTS,
    ],
  ])('%s', async (_n, over, code) => {
    expect(await codes(over)).toEqual([code]);
  });

  it('names who has the lead code now', async () => {
    const c = (await evaluate({ codeTakenBy: 'Acme' })).conflicts[0];
    expect(c.message).toBe('Its lead code LD-7 is now used by "Acme".');
  });

  it('reports every conflict, not just the first', async () => {
    expect(
      await codes({ leadExists: true, sourceExists: false, users: [] }),
    ).toEqual([
      LEAD_RESTORE_CONFLICT.ID_EXISTS,
      LEAD_RESTORE_CONFLICT.SOURCE_MISSING,
      LEAD_RESTORE_CONFLICT.USER_MISSING,
    ]);
  });

  it.each([
    ['null', null],
    ['an empty object', {}],
    ['a purged marker', { purged: true }],
    ['a lead without a source', { lead: { id: 'L1' } }],
  ])(
    'an unreadable snapshot (%s) is a conflict, not a crash',
    async (_n, snap) => {
      expect(await codes({}, snap)).toEqual([
        LEAD_RESTORE_CONFLICT.SNAPSHOT_INVALID,
      ]);
    },
  );

  it('does not look for a lead code when the lead had none', async () => {
    const snap = snapshot();
    (snap.lead as any).leadCode = null;
    const db = dbFor();
    await LEAD_DELETION_POLICY.restoreEvaluate(db, snap, { entityId: 'L1' });
    expect(db.lead.findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('lead restore: what is written', () => {
  const run = async (snap: unknown = snapshot()) => {
    const calls: Array<[string, any]> = [];
    const tx: any = {
      lead: {
        create: jest.fn(async (a: any) => calls.push(['lead.create', a])),
      },
      leadTimeline: {
        createMany: jest.fn(async (a: any) =>
          calls.push(['timeline.createMany', a]),
        ),
        create: jest.fn(async (a: any) => calls.push(['timeline.create', a])),
      },
      leadNote: {
        createMany: jest.fn(async (a: any) =>
          calls.push(['note.createMany', a]),
        ),
      },
      leadFollowup: {
        createMany: jest.fn(async (a: any) =>
          calls.push(['followup.createMany', a]),
        ),
      },
    };
    const now = new Date('2026-10-05T00:00:00.000Z');
    await LEAD_DELETION_POLICY.restore(tx, snap, {
      recordId: 'R1',
      actorId: 'U9',
      now,
    });
    return { calls, now };
  };

  it('recreates the lead first, with its original id and dates, then what it owned, then writes the restore event', async () => {
    const { calls } = await run();
    expect(calls.map((c) => c[0])).toEqual([
      'lead.create',
      'timeline.createMany',
      'note.createMany',
      'followup.createMany',
      'timeline.create',
    ]);
    const lead = calls[0][1].data;
    expect(lead.id).toBe('L1');
    expect(lead.customerName).toBe('Sterling Pumps');
    expect(lead.createdAt).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    expect(lead.deactivatedAt).toEqual(new Date('2026-09-02T00:00:00.000Z'));
    expect(lead.isActive).toBe(false);
    expect(lead.country).toBe('IN');
  });

  it('a restored lead is updated when it is restored, not when it was last touched', async () => {
    const { calls, now } = await run();
    expect(calls[0][1].data.updatedAt).toEqual(now);
  });

  it('writes only the columns it knows: no relation, nothing unexpected from the snapshot', async () => {
    const { calls } = await run();
    expect(calls[0][1].data).not.toHaveProperty('source');
    expect(calls[1][1].data[0]).not.toHaveProperty('surprise');
    expect(calls[1][1].data[0]).toMatchObject({
      id: 'T1',
      leadId: 'L1',
      action: 'LEAD_CREATED',
      occurredAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(calls[2][1].data[0]).toEqual({
      id: 'N1',
      leadId: 'L1',
      note: 'Needs pumps',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(calls[3][1].data[0]).toMatchObject({
      id: 'F1',
      status: 'CANCELLED',
      followupDate: new Date('2026-09-05T00:00:00.000Z'),
    });
  });

  it('writes a LEAD_RESTORED event by the person who restored it, naming the reason it was deleted', async () => {
    const { calls, now } = await run();
    expect(calls[4][1].data).toEqual({
      leadId: 'L1',
      action: 'LEAD_RESTORED',
      remarks:
        'Lead restored from the Recycle Bin. It had been deleted earlier.',
      actorId: 'U9',
      occurredAt: now,
    });
  });

  it('refuses a snapshot it cannot read (nothing is written)', async () => {
    await expect(run({ purged: true })).rejects.toThrow('not readable');
  });

  it('tells a survivor that still exists, and nobody when it is gone', async () => {
    const create = jest.fn(async () => ({}));
    await LEAD_DELETION_POLICY.recordSurvivorRestored(
      {
        $queryRaw: jest.fn(async () => [{ id: 'S1' }]),
        leadTimeline: { create },
      } as any,
      {
        survivorId: 'S1',
        restoredId: 'L1',
        restoredLabel: 'Sterling Pumps',
        actorId: 'U9',
      },
    );
    expect(create).toHaveBeenCalledWith({
      data: {
        leadId: 'S1',
        action: 'LEAD_DUPLICATE_RESTORED',
        remarks:
          'Lead "Sterling Pumps", deleted earlier as a duplicate of this lead, was restored.',
        actorId: 'U9',
      },
    });

    const none = jest.fn(async () => ({}));
    await LEAD_DELETION_POLICY.recordSurvivorRestored(
      {
        $queryRaw: jest.fn(async () => []),
        leadTimeline: { create: none },
      } as any,
      { survivorId: 'S1', restoredId: 'L1', restoredLabel: 'x', actorId: 'U9' },
    );
    expect(none).not.toHaveBeenCalled();
  });
});
