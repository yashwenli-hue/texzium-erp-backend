/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { LEAD_DEACTIVATED_MESSAGE } from '../leads/lead-lifecycle';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_TRANSITIONS,
  OpportunityStage,
} from './opportunity-stage';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const LEAD_ID = '11111111-1111-4111-8111-111111111111';
const INACTIVE_LEAD_ID = '22222222-2222-4222-8222-222222222222';
const OPP_ID = 'opp-1';
const ALL = [
  'opportunities.view',
  'opportunities.create',
  'opportunities.edit',
];

// The rules as the product states them, written out independently of the
// implementation's table so the two can disagree.
const ALLOWED: [OpportunityStage, OpportunityStage][] = [
  ['QUALIFIED', 'PROPOSAL'],
  ['QUALIFIED', 'LOST'],
  ['PROPOSAL', 'NEGOTIATION'],
  ['PROPOSAL', 'QUALIFIED'],
  ['PROPOSAL', 'LOST'],
  ['NEGOTIATION', 'WON'],
  ['NEGOTIATION', 'PROPOSAL'],
  ['NEGOTIATION', 'LOST'],
];
const REFUSED = OPPORTUNITY_STAGES.flatMap((from) =>
  OPPORTUNITY_STAGES.map((to) => [from, to] as [string, string]),
).filter(([f, t]) => !ALLOWED.some(([af, at]) => af === f && at === t));

describe('Opportunity stage', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] };
  let opportunities: Record<
    string,
    { id: string; leadId: string; title: string; status: string }
  >;
  let leadActive: Record<string, boolean>;
  let timeline: any[];
  let writes: string[];
  let order: string[];
  let calls: Record<string, any>;
  let inTransaction: boolean;

  const db: any = {
    opportunity: {
      findUnique: jest.fn(async (args: any) => {
        const o = opportunities[args.where.id];
        if (!o) return null;
        if (!args.select) return { ...o };
        return Object.fromEntries(
          Object.keys(args.select).map((k) => [k, (o as any)[k]]),
        );
      }),
      updateMany: jest.fn(async (args: any) => {
        order.push('opportunity.updateMany');
        calls.updateMany = args;
        const o = opportunities[args.where.id];
        if (!o || o.status !== args.where.status) return { count: 0 };
        Object.assign(o, args.data);
        writes.push('opportunity.updateMany');
        return { count: 1 };
      }),
      create: jest.fn(async (args: any) => {
        writes.push('opportunity.create');
        calls.create = args.data;
        return { id: 'o-new', ...args.data };
      }),
    },
    // A qualified lead: an opportunity can only be created for one (the gate has its
    // own tests in opportunity-create-gate.spec.ts).
    lead: {
      findUniqueOrThrow: jest.fn(async () => ({ status: 'SALES_ASSIGNED' })),
    },
    user: {
      findUnique: jest.fn(async (args: any) =>
        args.where.id === 'user-1' ? { id: 'user-1' } : null,
      ),
    },
    leadTimeline: {
      create: jest.fn(async (args: any) => {
        order.push('leadTimeline.create');
        writes.push('leadTimeline.create');
        timeline.push(args.data);
        return { id: 'tl', ...args.data };
      }),
    },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, id: string) => {
      order.push('lead.lock');
      calls.locks.push({
        sql: strings.join('?').replace(/\s+/g, ' ').trim(),
        id,
        inTransaction,
      });
      return id in leadActive ? [{ id, isActive: leadActive[id] }] : [];
    }),
    $transaction: jest.fn(async (arg: any) => {
      inTransaction = true;
      return arg(db);
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OpportunitiesController],
      providers: [
        OpportunitiesService,
        { provide: PrismaService, useValue: db },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          ctx.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .overrideGuard(RecordScopeGuard)
      .useValue(SCOPE_TESTED_ELSEWHERE)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const seed = (status: string) => {
    opportunities = {
      [OPP_ID]: {
        id: OPP_ID,
        leadId: LEAD_ID,
        title: 'Hydraulic Systems Upgrade',
        status,
      },
      inactive: {
        id: 'inactive',
        leadId: INACTIVE_LEAD_ID,
        title: 'Orphaned',
        status: 'QUALIFIED',
      },
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    user = { id: 'user-1', permissions: ALL };
    seed('QUALIFIED');
    leadActive = { [LEAD_ID]: true, [INACTIVE_LEAD_ID]: false };
    timeline = [];
    writes = [];
    order = [];
    calls = { locks: [] };
    inTransaction = false;
  });

  const http = () => request(app.getHttpServer());
  const move = (id: string, body: unknown) =>
    http()
      .patch(`/opportunities/${id}/stage`)
      .send(body as object);
  const moveTo = (from: string, to: string, id = OPP_ID) =>
    move(id, { fromStage: from, toStage: to });

  it('has exactly the five stages the product defines', () => {
    expect([...OPPORTUNITY_STAGES]).toEqual([
      'QUALIFIED',
      'PROPOSAL',
      'NEGOTIATION',
      'WON',
      'LOST',
    ]);
  });

  describe('transition table', () => {
    it('matches the rules as written out in this spec', () => {
      for (const from of OPPORTUNITY_STAGES) {
        const expected = ALLOWED.filter(([f]) => f === from).map(([, t]) => t);
        expect([...OPPORTUNITY_STAGE_TRANSITIONS[from]].sort()).toEqual(
          [...expected].sort(),
        );
      }
    });

    it('lets Lost be reached from every open stage and from nothing else', () => {
      const intoLost = OPPORTUNITY_STAGES.filter((s) =>
        OPPORTUNITY_STAGE_TRANSITIONS[s].includes('LOST'),
      );
      expect(intoLost).toEqual(['QUALIFIED', 'PROPOSAL', 'NEGOTIATION']);
    });

    it('treats Won and Lost as final', () => {
      expect(OPPORTUNITY_STAGE_TRANSITIONS.WON).toEqual([]);
      expect(OPPORTUNITY_STAGE_TRANSITIONS.LOST).toEqual([]);
    });
  });

  describe('permission and identity', () => {
    it.each([
      [
        'opportunities.view and create only',
        ['opportunities.view', 'opportunities.create'],
      ],
      ['no permissions', []],
    ])('is refused with %s', async (_n, permissions) => {
      user = { id: 'user-1', permissions };
      const res = await moveTo('QUALIFIED', 'PROPOSAL');
      expect(res.status).toBe(403);
      expect(writes).toEqual([]);
      expect(opportunities[OPP_ID].status).toBe('QUALIFIED');
    });

    it('rejects a request with no user id and a token for a missing user', async () => {
      user = { permissions: ALL };
      expect((await moveTo('QUALIFIED', 'PROPOSAL')).status).toBe(401);
      user = { id: 'ghost', permissions: ALL };
      expect((await moveTo('QUALIFIED', 'PROPOSAL')).status).toBe(401);
      expect(writes).toEqual([]);
    });
  });

  describe('request validation', () => {
    it.each([
      ['no body', {}],
      ['missing toStage', { fromStage: 'QUALIFIED' }],
      ['missing fromStage', { toStage: 'PROPOSAL' }],
      ['the old OPEN value', { fromStage: 'OPEN', toStage: 'PROPOSAL' }],
      ['lowercase stage', { fromStage: 'qualified', toStage: 'proposal' }],
      ['title-case stage', { fromStage: 'Qualified', toStage: 'Proposal' }],
      ['unknown stage', { fromStage: 'QUALIFIED', toStage: 'ARCHIVED' }],
      ['non-string stage', { fromStage: 1, toStage: 2 }],
      [
        'client-supplied actor',
        { fromStage: 'QUALIFIED', toStage: 'PROPOSAL', actorId: 'someone' },
      ],
      [
        'client-supplied status',
        { fromStage: 'QUALIFIED', toStage: 'PROPOSAL', status: 'WON' },
      ],
      [
        'client-supplied owner',
        { fromStage: 'QUALIFIED', toStage: 'PROPOSAL', ownerId: 'x' },
      ],
    ])('rejects %s and writes nothing', async (_n, body) => {
      const res = await move(OPP_ID, body);
      expect(res.status).toBe(400);
      expect(writes).toEqual([]);
      expect(opportunities[OPP_ID].status).toBe('QUALIFIED');
    });
  });

  describe('transitions', () => {
    it.each(ALLOWED)('allows %s -> %s', async (from, to) => {
      seed(from);
      const res = await moveTo(from, to);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(to);
      expect(opportunities[OPP_ID].status).toBe(to);
      expect(timeline).toHaveLength(1);
    });

    it.each(REFUSED)(
      'refuses %s -> %s with 400 and writes nothing',
      async (from, to) => {
        seed(from);
        const res = await moveTo(from, to);
        expect(res.status).toBe(400);
        expect(writes).toEqual([]);
        expect(timeline).toEqual([]);
        expect(opportunities[OPP_ID].status).toBe(from);
      },
    );

    it('explains why in plain words', async () => {
      expect((await moveTo('WON', 'LOST')).body.message).toBe(
        "A Won opportunity is final and can't be moved.",
      );
      expect((await moveTo('LOST', 'QUALIFIED')).body.message).toBe(
        "A Lost opportunity is final and can't be moved.",
      );
      expect((await moveTo('PROPOSAL', 'PROPOSAL')).body.message).toBe(
        'The opportunity is already in Proposal.',
      );
      expect((await moveTo('QUALIFIED', 'WON')).body.message).toBe(
        "An opportunity can't move from Qualified to Won. Move it one step at a time, or mark it Lost.",
      );
    });

    it('decides a refused move from the rules alone, before touching the database', async () => {
      await moveTo('QUALIFIED', 'WON');
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('atomic update and history', () => {
    it('updates only while the opportunity is still in the stage the caller saw, in one transaction', async () => {
      await moveTo('QUALIFIED', 'PROPOSAL');
      expect(inTransaction).toBe(true);
      expect(calls.updateMany).toEqual({
        where: { id: OPP_ID, status: 'QUALIFIED' },
        data: { status: 'PROPOSAL' },
      });
    });

    it('locks the lead (shared) inside the transaction before the update', async () => {
      await moveTo('QUALIFIED', 'PROPOSAL');
      expect(calls.locks).toHaveLength(1);
      expect(calls.locks[0]).toMatchObject({
        id: LEAD_ID,
        inTransaction: true,
      });
      expect(calls.locks[0].sql).toContain('FOR SHARE');
      expect(order).toEqual([
        'lead.lock',
        'opportunity.updateMany',
        'leadTimeline.create',
      ]);
    });

    it('records OPPORTUNITY_STAGE_CHANGED as an attributed SYSTEM event, not an employee activity', async () => {
      const res = await moveTo('QUALIFIED', 'PROPOSAL');
      expect(res.status).toBe(200);
      expect(timeline).toHaveLength(1);
      const row = timeline[0];
      expect(row).toMatchObject({
        leadId: LEAD_ID,
        action: 'OPPORTUNITY_STAGE_CHANGED',
        actorId: 'user-1',
        remarks:
          'Opportunity "Hydraulic Systems Upgrade": Qualified → Proposal',
      });
      expect(row.occurredAt).toBeInstanceOf(Date);
      expect(row.source ?? 'SYSTEM').toBe('SYSTEM');
      expect(row.activityType).toBeUndefined();
    });

    it('takes the actor from the signed-in user only', async () => {
      user = { id: 'user-1', permissions: ALL };
      await moveTo('QUALIFIED', 'LOST');
      expect(timeline[0].actorId).toBe('user-1');
    });

    it('returns the updated opportunity row and nothing about the lead', async () => {
      const res = await moveTo('QUALIFIED', 'PROPOSAL');
      expect(Object.keys(res.body).sort()).toEqual(
        ['id', 'leadId', 'status', 'title'].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });

    it('walks forward and back one step at a time, one history row per move', async () => {
      await moveTo('QUALIFIED', 'PROPOSAL');
      await moveTo('PROPOSAL', 'NEGOTIATION');
      await moveTo('NEGOTIATION', 'PROPOSAL');
      expect((await moveTo('PROPOSAL', 'NEGOTIATION')).status).toBe(200);
      expect((await moveTo('NEGOTIATION', 'WON')).status).toBe(200);
      expect(timeline.map((t) => t.remarks)).toEqual([
        'Opportunity "Hydraulic Systems Upgrade": Qualified → Proposal',
        'Opportunity "Hydraulic Systems Upgrade": Proposal → Negotiation',
        'Opportunity "Hydraulic Systems Upgrade": Negotiation → Proposal',
        'Opportunity "Hydraulic Systems Upgrade": Proposal → Negotiation',
        'Opportunity "Hydraulic Systems Upgrade": Negotiation → Won',
      ]);
      // Won is final.
      const before = writes.length;
      expect((await moveTo('WON', 'NEGOTIATION')).status).toBe(400);
      expect((await moveTo('NEGOTIATION', 'LOST')).status).toBe(409);
      expect(writes.length).toBe(before);
      expect(opportunities[OPP_ID].status).toBe('WON');
    });
  });

  describe('conflicts and missing records', () => {
    it('answers 409 when the stored stage is no longer the one the caller saw', async () => {
      seed('PROPOSAL');
      const res = await moveTo('QUALIFIED', 'PROPOSAL');
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        "This opportunity's stage has changed (now Proposal). Reload and try again.",
      );
      expect(timeline).toEqual([]);
      expect(opportunities[OPP_ID].status).toBe('PROPOSAL');
    });

    it('does not let a stale screen regress a deal that moved on', async () => {
      seed('NEGOTIATION');
      // The caller still sees Qualified and asks for "the next step".
      expect((await moveTo('QUALIFIED', 'PROPOSAL')).status).toBe(409);
      expect(opportunities[OPP_ID].status).toBe('NEGOTIATION');
    });

    it('answers 409 for a row that still holds the old OPEN value', async () => {
      seed('OPEN');
      const res = await moveTo('QUALIFIED', 'PROPOSAL');
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('(now OPEN)');
      expect(opportunities[OPP_ID].status).toBe('OPEN');
      expect(timeline).toEqual([]);
    });

    it('answers 409 when the opportunity is already final', async () => {
      seed('LOST');
      expect((await moveTo('QUALIFIED', 'PROPOSAL')).status).toBe(409);
      expect(opportunities[OPP_ID].status).toBe('LOST');
    });

    it('answers 404 for an unknown opportunity and writes nothing', async () => {
      const res = await moveTo('QUALIFIED', 'PROPOSAL', 'nope');
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Opportunity not found.');
      expect(writes).toEqual([]);
    });

    it('answers 404 when the opportunity disappears between the read and the update', async () => {
      db.opportunity.updateMany.mockImplementationOnce(async () => {
        delete opportunities[OPP_ID];
        return { count: 0 };
      });
      expect((await moveTo('QUALIFIED', 'PROPOSAL')).status).toBe(404);
      expect(timeline).toEqual([]);
    });

    it('refuses a move on a deactivated lead and changes nothing', async () => {
      const res = await moveTo('QUALIFIED', 'PROPOSAL', 'inactive');
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(LEAD_DEACTIVATED_MESSAGE);
      expect(writes).toEqual([]);
      expect(opportunities.inactive.status).toBe('QUALIFIED');
    });

    it('lets only one of two identical simultaneous requests through', async () => {
      const results = await Promise.all([
        moveTo('QUALIFIED', 'PROPOSAL'),
        moveTo('QUALIFIED', 'PROPOSAL'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(timeline).toHaveLength(1);
      expect(opportunities[OPP_ID].status).toBe('PROPOSAL');
    });
  });

  describe('create', () => {
    const valid = {
      leadId: LEAD_ID,
      title: '  Hydraulic Systems Upgrade  ',
      expectedValue: 1840000,
      probability: 35,
      expectedCloseDate: '2026-12-31T00:00:00.000Z',
    };
    const create = (body: unknown) =>
      http()
        .post('/opportunities')
        .send(body as object);

    it('starts every opportunity at QUALIFIED, set explicitly', async () => {
      const res = await create(valid);
      expect(res.status).toBe(201);
      expect(calls.create.status).toBe('QUALIFIED');
      expect(calls.create.title).toBe('Hydraulic Systems Upgrade');
    });

    it('cannot be given a stage by the client', async () => {
      const res = await create({ ...valid, status: 'WON' });
      expect(res.status).toBe(400);
      expect(writes).toEqual([]);
      expect((await create({ ...valid, stage: 'WON' })).status).toBe(400);
    });

    it('is still refused for a deactivated lead', async () => {
      const res = await create({ ...valid, leadId: INACTIVE_LEAD_ID });
      expect(res.status).toBe(409);
      expect(writes).toEqual([]);
    });

    it.each([
      ['a lead id that is not a UUID', { leadId: 'clean' }],
      ['no lead id', { leadId: undefined }],
      ['an empty title', { title: '' }],
      ['a whitespace-only title', { title: '   ' }],
      ['a title over 200 characters', { title: 'x'.repeat(201) }],
      ['a non-string title', { title: 5 }],
      ['a zero value', { expectedValue: 0 }],
      ['a negative value', { expectedValue: -5 }],
      ['a value sent as text', { expectedValue: '100' }],
      ['a missing value', { expectedValue: undefined }],
      ['a probability below 0', { probability: -1 }],
      ['a probability above 100', { probability: 101 }],
      ['a fractional probability', { probability: 35.5 }],
      ['a probability sent as text', { probability: '35' }],
      ['a date that is not a date', { expectedCloseDate: 'tomorrow' }],
      ['an impossible calendar date', { expectedCloseDate: '2026-02-30' }],
      ['a numeric date', { expectedCloseDate: 1790000000000 }],
      ['a missing date', { expectedCloseDate: undefined }],
      ['an unknown property', { opportunityCode: 'X' }],
    ])('rejects %s and writes nothing', async (_n, patch) => {
      const res = await create({ ...valid, ...patch });
      expect(res.status).toBe(400);
      expect(writes).toEqual([]);
    });

    it.each([
      ['probability 0', { probability: 0 }],
      ['probability 100', { probability: 100 }],
      ['a 200-character title', { title: 'y'.repeat(200) }],
      ['a date without a time', { expectedCloseDate: '2026-12-31' }],
      ['a date in the past', { expectedCloseDate: '2020-01-01T00:00:00.000Z' }],
      ['a small positive value', { expectedValue: 0.5 }],
    ])('accepts %s', async (_n, patch) => {
      expect((await create({ ...valid, ...patch })).status).toBe(201);
    });
  });
});
