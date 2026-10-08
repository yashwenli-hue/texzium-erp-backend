/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion -- test doubles are intentionally loosely typed */
import {
  LEAD_BLOCKER,
  LEAD_DELETION_POLICY,
  LEAD_DUPLICATE_REMOVED_ACTION,
  leadBlockers,
} from './lead-deletion.policy';

// The lead's deletion rules against a database double that answers the counts the policy
// asks for. The same rules run against a real database (locks, races, the tombstone) on a
// scratch database.

interface Facts {
  opportunities: number;
  employeeActivity: number;
  decisions: number;
  pending: number;
  completed: number;
  cancelled: number;
  timeline: number;
  notes: number;
  updatedAt: string;
  isActive: boolean;
  missing: boolean;
}

const quiet = (over: Partial<Facts> = {}): Facts => ({
  opportunities: 0,
  employeeActivity: 0,
  decisions: 0,
  pending: 0,
  completed: 0,
  cancelled: 0,
  timeline: 1,
  notes: 0,
  updatedAt: '2026-10-01T10:00:00.000Z',
  isActive: true,
  missing: false,
  ...over,
});

function dbFor(f: Facts) {
  const wheres: any[] = [];
  return {
    wheres,
    db: {
      lead: {
        findUnique: jest.fn(async () =>
          f.missing
            ? null
            : {
                id: 'L1',
                customerName: 'Sterling Pumps',
                leadCode: 'LD-7',
                isActive: f.isActive,
                updatedAt: new Date(f.updatedAt),
              },
        ),
      },
      opportunity: { count: jest.fn(async () => f.opportunities) },
      leadTimeline: {
        count: jest.fn(async (args: any) => {
          wheres.push(args.where);
          if (args.where.source) return f.employeeActivity;
          if (args.where.action) return f.decisions;
          return f.timeline;
        }),
      },
      leadFollowup: {
        count: jest.fn(async (args: any) => {
          const status = args.where.status;
          return status === 'PENDING'
            ? f.pending
            : status === 'COMPLETED'
              ? f.completed
              : f.cancelled;
        }),
      },
      leadNote: { count: jest.fn(async () => f.notes) },
    } as any,
  };
}

const evaluate = (f: Facts) => LEAD_DELETION_POLICY.evaluate(dbFor(f).db, 'L1');

describe('lead deletion: what blocks it', () => {
  it('nothing blocks a lead that only has what the system wrote (creation, import, edits, status, assignment, deactivation, cancelled follow-ups, imported notes)', async () => {
    const result = await evaluate(
      quiet({ timeline: 14, notes: 2, cancelled: 3 }),
    );
    expect(result?.blockers).toEqual([]);
  });

  it.each([
    [
      'an opportunity',
      { opportunities: 1 },
      LEAD_BLOCKER.OPPORTUNITIES,
      'It has 1 opportunity, so it is part of the sales pipeline.',
    ],
    [
      'several opportunities',
      { opportunities: 3 },
      LEAD_BLOCKER.OPPORTUNITIES,
      'It has 3 opportunities, so it is part of the sales pipeline.',
    ],
    [
      'an employee-logged activity',
      { employeeActivity: 1 },
      LEAD_BLOCKER.EMPLOYEE_ACTIVITY,
      '1 activity was logged on it by your team.',
    ],
    [
      'employee-logged activities',
      { employeeActivity: 4 },
      LEAD_BLOCKER.EMPLOYEE_ACTIVITY,
      '4 activities were logged on it by your team.',
    ],
    [
      'a qualification or a rejection',
      { decisions: 1 },
      LEAD_BLOCKER.QUALIFIED_OR_REJECTED,
      'A sales decision (qualified or rejected) was recorded on it.',
    ],
    [
      'a completed follow-up',
      { completed: 1 },
      LEAD_BLOCKER.COMPLETED_FOLLOWUPS,
      '1 follow-up was completed.',
    ],
    [
      'completed follow-ups',
      { completed: 2 },
      LEAD_BLOCKER.COMPLETED_FOLLOWUPS,
      '2 follow-ups were completed.',
    ],
    [
      'a pending follow-up',
      { pending: 1 },
      LEAD_BLOCKER.PENDING_FOLLOWUPS,
      'It has 1 pending follow-up.',
    ],
    [
      'pending follow-ups',
      { pending: 2 },
      LEAD_BLOCKER.PENDING_FOLLOWUPS,
      'It has 2 pending follow-ups.',
    ],
  ])(
    '%s blocks, alone, with its own code, count and words',
    async (_name, over, code, message) => {
      const result = await evaluate(quiet(over as Partial<Facts>));

      expect(result?.blockers).toHaveLength(1);
      expect(result?.blockers[0]).toMatchObject({ code, message });
      expect(result?.blockers[0].count).toBeGreaterThan(0);
      expect(result?.blockers[0].hint).toBeTruthy();
    },
  );

  it('lists every blocker that applies, not just the first', async () => {
    const result = await evaluate(
      quiet({
        opportunities: 1,
        employeeActivity: 2,
        decisions: 1,
        completed: 1,
        pending: 1,
      }),
    );
    expect(result?.blockers.map((b) => b.code)).toEqual([
      LEAD_BLOCKER.OPPORTUNITIES,
      LEAD_BLOCKER.EMPLOYEE_ACTIVITY,
      LEAD_BLOCKER.QUALIFIED_OR_REJECTED,
      LEAD_BLOCKER.COMPLETED_FOLLOWUPS,
      LEAD_BLOCKER.PENDING_FOLLOWUPS,
    ]);
  });

  it('counts employee activity by source = EMPLOYEE, and decisions by LEAD_QUALIFIED / LEAD_REJECTED only', async () => {
    const { db, wheres } = dbFor(quiet());
    await LEAD_DELETION_POLICY.evaluate(db, 'L1');

    expect(wheres).toContainEqual({ leadId: 'L1', source: 'EMPLOYEE' });
    expect(wheres).toContainEqual({
      leadId: 'L1',
      action: { in: ['LEAD_QUALIFIED', 'LEAD_REJECTED'] },
    });
  });

  it('is null for a lead that does not exist', async () => {
    expect(await evaluate(quiet({ missing: true }))).toBeNull();
  });

  it('every blocker the policy can raise is among the codes recorded as checked', () => {
    const all = leadBlockers({
      opportunities: 1,
      employeeActivity: 1,
      decisions: 1,
      completedFollowups: 1,
      pendingFollowups: 1,
    });
    expect(all.map((b) => b.code).sort()).toEqual(
      [...LEAD_DELETION_POLICY.blockerCodes].sort(),
    );
  });
});

describe('lead deletion: what it removes, and the token', () => {
  it('names the lead and its code, and lists what goes with it (only what exists)', async () => {
    const result = await evaluate(
      quiet({ timeline: 9, notes: 2, cancelled: 1 }),
    );

    expect(result?.label).toBe('Sterling Pumps');
    expect(result?.code).toBe('LD-7');
    expect(result?.removes).toEqual([
      { label: 'The lead record', count: 1 },
      { label: 'History events', count: 9 },
      { label: 'Imported notes', count: 2 },
      { label: 'Cancelled follow-ups', count: 1 },
    ]);
    expect((await evaluate(quiet({ timeline: 1 })))?.removes).toEqual([
      { label: 'The lead record', count: 1 },
      { label: 'History events', count: 1 },
    ]);
  });

  it('gives the same token for the same state, and a different one when ANY fact it rests on changes', async () => {
    const base = (await evaluate(quiet()))?.version;
    expect((await evaluate(quiet()))?.version).toBe(base);

    const changes: Array<Partial<Facts>> = [
      { opportunities: 1 },
      { employeeActivity: 1 },
      { decisions: 1 },
      { pending: 1 },
      { completed: 1 },
      { cancelled: 1 },
      { timeline: 2 },
      { notes: 1 },
      { isActive: false },
      { updatedAt: '2026-10-01T10:00:01.000Z' },
    ];

    for (const change of changes) {
      expect((await evaluate(quiet(change)))?.version).not.toBe(base);
    }
  });
});

describe('lead deletion: locking, capture and removal', () => {
  it('locks the lead (and a survivor) exclusively, in id order', async () => {
    const calls: any[] = [];
    const tx: any = {
      $queryRaw: jest.fn(async (...args: any[]) => {
        calls.push(args);
        return [{ id: 'a' }, { id: 'b' }];
      }),
    };

    expect(await LEAD_DELETION_POLICY.lockRows(tx, ['b', 'a'])).toEqual([
      'a',
      'b',
    ]);

    const sql = (calls[0][0] as string[]).join('?');
    expect(sql).toContain('FROM "Lead"');
    expect(sql).toContain('ORDER BY "id"');
    expect(sql).toContain('FOR UPDATE');
  });

  it('captures the lead and everything removed with it, with the people named, as plain JSON', async () => {
    const lead = {
      id: 'L1',
      customerName: 'Sterling',
      assignedToId: 'u1',
      deactivatedById: 'u2',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      source: { id: 's', name: 'Web' },
    };
    const db: any = {
      lead: { findUniqueOrThrow: jest.fn(async () => lead) },
      leadTimeline: {
        findMany: jest.fn(async () => [
          {
            id: 't1',
            actorId: 'u3',
            occurredAt: new Date('2026-09-02T00:00:00Z'),
          },
          { id: 't2', actorId: null },
        ]),
      },
      leadNote: {
        findMany: jest.fn(async () => [{ id: 'n1', note: 'Needs pumps' }]),
      },
      leadFollowup: {
        findMany: jest.fn(async () => [
          { id: 'f1', completedById: 'u4', status: 'CANCELLED' },
        ]),
      },
      user: {
        findMany: jest.fn(async (args: any) =>
          args.where.id.in.sort().map((id: string) => ({
            id,
            fullName: `Person ${id}`,
            email: `${id}@x.test`,
          })),
        ),
      },
    };

    const snapshot: any = await LEAD_DELETION_POLICY.capture(db, 'L1');

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.lead.customerName).toBe('Sterling');
    expect(snapshot.lead.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(snapshot.timelines).toHaveLength(2);
    expect(snapshot.notes[0].note).toBe('Needs pumps');
    expect(snapshot.followups[0].status).toBe('CANCELLED');
    expect(snapshot.people.map((p: any) => p.id)).toEqual([
      'u1',
      'u2',
      'u3',
      'u4',
    ]);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('removes what the lead owns, then the lead (the foreign keys are RESTRICT, so the order matters)', async () => {
    const order: string[] = [];
    const tx: any = {
      leadTimeline: { deleteMany: jest.fn(async () => order.push('timeline')) },
      leadNote: { deleteMany: jest.fn(async () => order.push('notes')) },
      leadFollowup: {
        deleteMany: jest.fn(async () => order.push('followups')),
      },
      lead: { delete: jest.fn(async () => order.push('lead')) },
    };

    await LEAD_DELETION_POLICY.remove(tx, 'L1');

    expect(order).toEqual(['timeline', 'notes', 'followups', 'lead']);
    expect(tx.lead.delete).toHaveBeenCalledWith({ where: { id: 'L1' } });
    expect(tx.leadTimeline.deleteMany).toHaveBeenCalledWith({
      where: { leadId: 'L1' },
    });
  });

  it('tells the survivor in its own history, naming the removed lead and the reason, with the actor', async () => {
    const create = jest.fn(async () => ({}));
    await LEAD_DELETION_POLICY.recordSurvivorEvent(
      { leadTimeline: { create } } as any,
      {
        survivorId: 'S1',
        removedId: 'L1',
        removedLabel: 'Sterling Pumps',
        reasonCode: 'DUPLICATE',
        reason: 'Same buyer, entered twice',
        actorId: 'user-1',
      },
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        leadId: 'S1',
        action: LEAD_DUPLICATE_REMOVED_ACTION,
        remarks:
          'Duplicate lead "Sterling Pumps" was permanently deleted. Reason: Same buyer, entered twice',
        actorId: 'user-1',
      },
    });
  });

  it('reads a survivor by its name, and a missing survivor as null', async () => {
    const found: any = {
      lead: { findUnique: jest.fn(async () => ({ customerName: 'Acme' })) },
    };
    const missing: any = { lead: { findUnique: jest.fn(async () => null) } };
    expect(await LEAD_DELETION_POLICY.survivorLabel(found, 'S1')).toBe('Acme');
    expect(await LEAD_DELETION_POLICY.survivorLabel(missing, 'S1')).toBeNull();
  });
});
