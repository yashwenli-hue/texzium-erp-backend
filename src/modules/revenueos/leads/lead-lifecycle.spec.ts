/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { LeadAssignmentsController } from '../lead-assignments/lead-assignments.controller';
import { LeadAssignmentsService } from '../lead-assignments/lead-assignments.service';
import { LeadFollowupsController } from '../lead-followups/lead-followups.controller';
import { LeadFollowupsService } from '../lead-followups/lead-followups.service';
import { LeadStatusController } from '../lead-status/lead-status.controller';
import { LeadStatusService } from '../lead-status/lead-status.service';
import { OpportunitiesController } from '../opportunities/opportunities.controller';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import { SalesReportsController } from '../sales-reports/sales-reports.controller';
import { SalesReportsService } from '../sales-reports/sales-reports.service';
import { LEAD_DEACTIVATED_MESSAGE } from './lead-lifecycle';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

const ALL = [
  'leads.view',
  'leads.edit',
  'leads.deactivate',
  'leads.assign',
  'leads.qualify',
  'leads.reject',
  'leads.status.update',
  'leads.followups.create',
  'opportunities.create',
];

// Creating an opportunity now needs a UUID lead id, so these leads are named by
// UUID when that endpoint is called. The fake database resolves them back to
// the lead keys used everywhere else in this spec.
const LEAD_UUID: Record<string, string> = {
  clean: '00000000-0000-4000-8000-000000000001',
  inactive: '00000000-0000-4000-8000-000000000002',
  nope: '00000000-0000-4000-8000-000000000003',
};
const leadKey = (id: string) =>
  Object.entries(LEAD_UUID).find(([, uuid]) => uuid === id)?.[0] ?? id;

interface FakeLead {
  id: string;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedById: string | null;
  deactivationReason: string | null;
  status: string;
  assignedToId: string | null;
  assignedTo: { fullName: string } | null;
}

describe('Lead deactivate / reactivate', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] };
  let leads: Record<string, FakeLead>;
  let opportunities: { leadId: string }[];
  let followups: { leadId: string; status: string }[];
  let writes: string[];
  let timeline: any[];
  let calls: Record<string, any>;
  let inTransaction: boolean;

  const fresh = (id: string, isActive = true): FakeLead => ({
    id,
    isActive,
    deactivatedAt: isActive ? null : new Date('2026-10-01T10:00:00Z'),
    deactivatedById: isActive ? null : 'user-1',
    deactivationReason: isActive ? null : 'Duplicate entry',
    status: 'NEW',
    assignedToId: null,
    assignedTo: null,
  });

  const matches = (l: FakeLead, where: any) => {
    if (where.id !== undefined && l.id !== where.id) return false;
    if (where.isActive !== undefined && l.isActive !== where.isActive)
      return false;
    if (
      where.opportunities?.none &&
      opportunities.some((o) => o.leadId === l.id)
    )
      return false;
    if (where.followups?.none) {
      const wanted = where.followups.none.status;
      if (followups.some((f) => f.leadId === l.id && f.status === wanted))
        return false;
    }
    return true;
  };
  const counts = (id: string) => ({
    opportunities: opportunities.filter((o) => o.leadId === id).length,
    followups: followups.filter(
      (f) => f.leadId === id && f.status === 'PENDING',
    ).length,
  });

  const db: any = {
    lead: {
      findUnique: jest.fn(async (args: any) => {
        const l = leads[args.where.id];
        if (!l) return null;
        if (args.include) calls.findOneInclude = args.include;
        if (args.select?._count) calls.countSelect = args.select._count;
        return args.select?._count ? { ...l, _count: counts(l.id) } : { ...l };
      }),
      findMany: jest.fn(async (args: any) => {
        calls.findManyWhere = args.where;
        return Object.values(leads).filter(
          (l) => !args.where || matches(l, args.where),
        );
      }),
      count: jest.fn(async (args?: any) => {
        calls.countWhere = args?.where;
        return Object.values(leads).filter(
          (l) => !args?.where || matches(l, args.where),
        ).length;
      }),
      updateMany: jest.fn(async (args: any) => {
        calls.updateMany = args;
        const hit = Object.values(leads).filter((l) => matches(l, args.where));
        hit.forEach((l) => Object.assign(l, args.data));
        if (hit.length) writes.push('lead.updateMany');
        return { count: hit.length };
      }),
      update: jest.fn(async (args: any) => {
        writes.push('lead.update');
        return { id: args.where.id };
      }),
      // The opportunity create gate reads the status; these leads are all eligible.
      findUniqueOrThrow: jest.fn(async (args: any) => ({
        status: leads[args.where.id]?.status ?? 'SALES_ASSIGNED',
      })),
    },
    user: {
      // user-1 is the signed-in user; u9 is an active user leads are assigned to.
      findUnique: jest.fn(async (args: any) =>
        args.where.id === 'user-1'
          ? { id: 'user-1' }
          : args.where.id === 'u9'
            ? { id: 'u9', fullName: 'User Nine', status: 'ACTIVE' }
            : null,
      ),
    },
    leadSource: { findUnique: jest.fn(async () => ({ id: 's1' })) },
    leadTimeline: {
      create: jest.fn(async (args: any) => {
        writes.push('leadTimeline.create');
        timeline.push(args.data);
        return { id: 'tl', ...args.data };
      }),
    },
    leadFollowup: {
      create: jest.fn(async (args: any) => {
        writes.push('leadFollowup.create');
        return { id: 'f-new', ...args.data };
      }),
      findUnique: jest.fn(async (args: any) =>
        args.where.id === 'f-pending'
          ? { id: 'f-pending', leadId: 'inactive', status: 'PENDING' }
          : null,
      ),
      update: jest.fn(async (args: any) => {
        writes.push('leadFollowup.update');
        return { id: args.where.id, status: args.data.status };
      }),
    },
    opportunity: {
      create: jest.fn(async (args: any) => {
        writes.push('opportunity.create');
        return { id: 'o-new', ...args.data };
      }),
      count: jest.fn(async () => 3),
    },
    quotation: { count: jest.fn(async () => 0) },
    salesOrder: { count: jest.fn(async () => 0) },
    salesInvoice: { count: jest.fn(async () => 0) },
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, id: string) => {
      const key = leadKey(id);
      calls.locks.push({
        sql: strings.join('?').replace(/\s+/g, ' ').trim(),
        id: key,
        inTransaction,
      });
      const l = leads[key];
      return l ? [{ id: key, isActive: l.isActive }] : [];
    }),
    $transaction: jest.fn(async (arg: any) => {
      if (typeof arg === 'function') {
        inTransaction = true;
        return arg(db);
      }
      return Promise.all(arg);
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        LeadsController,
        LeadStatusController,
        LeadAssignmentsController,
        LeadFollowupsController,
        OpportunitiesController,
        SalesReportsController,
      ],
      providers: [
        LeadsService,
        LeadStatusService,
        LeadAssignmentsService,
        LeadFollowupsService,
        OpportunitiesService,
        SalesReportsService,
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

  beforeEach(() => {
    user = { id: 'user-1', permissions: ALL };
    leads = {
      clean: fresh('clean'),
      inactive: fresh('inactive', false),
      withOpp: fresh('withOpp'),
      withFollowups: fresh('withFollowups'),
      withBoth: fresh('withBoth'),
      resolvedOnly: fresh('resolvedOnly'),
    };
    opportunities = [{ leadId: 'withOpp' }, { leadId: 'withBoth' }];
    followups = [
      { leadId: 'withFollowups', status: 'PENDING' },
      { leadId: 'withFollowups', status: 'PENDING' },
      { leadId: 'withBoth', status: 'PENDING' },
      { leadId: 'resolvedOnly', status: 'COMPLETED' },
      { leadId: 'resolvedOnly', status: 'CANCELLED' },
    ];
    writes = [];
    timeline = [];
    calls = { locks: [] };
    inTransaction = false;
  });

  const http = () => request(app.getHttpServer());
  const deactivate = (
    id: string,
    body: unknown = { reason: 'Duplicate entry' },
  ) =>
    http()
      .patch(`/leads/${id}/deactivate`)
      .send(body as object);
  const reactivate = (id: string) => http().patch(`/leads/${id}/reactivate`);

  describe('permission', () => {
    it.each([
      ['deactivate', () => deactivate('clean')],
      ['reactivate', () => reactivate('inactive')],
    ])(
      '%s needs leads.deactivate (leads.edit is not enough)',
      async (_n, call) => {
        user = { id: 'user-1', permissions: ['leads.view', 'leads.edit'] };
        const res = await call();
        expect(res.status).toBe(403);
        expect(writes).toEqual([]);
      },
    );

    it('rejects a request with no user id and a token for a missing user', async () => {
      user = { permissions: ALL };
      expect((await deactivate('clean')).status).toBe(401);
      user = { id: 'ghost', permissions: ALL };
      expect((await deactivate('clean')).status).toBe(401);
      expect((await reactivate('inactive')).status).toBe(401);
      expect(writes).toEqual([]);
    });
  });

  describe('deactivate: validation', () => {
    it.each([
      ['no body', {}],
      ['empty reason', { reason: '' }],
      ['whitespace-only reason', { reason: '  \n\t ' }],
      ['reason over 500 characters', { reason: 'x'.repeat(501) }],
      ['non-string reason', { reason: 7 }],
      [
        'client-supplied actor',
        { reason: 'ok', deactivatedById: 'someone-else' },
      ],
      ['client-supplied state', { reason: 'ok', isActive: false }],
      [
        'client-supplied timestamp',
        { reason: 'ok', deactivatedAt: '2026-01-01' },
      ],
    ])('rejects %s and writes nothing', async (_n, body) => {
      const res = await deactivate('clean', body);
      expect(res.status).toBe(400);
      expect(writes).toEqual([]);
      expect(leads.clean.isActive).toBe(true);
    });

    it('accepts a reason of exactly 500 characters', async () => {
      expect(
        (await deactivate('clean', { reason: 'y'.repeat(500) })).status,
      ).toBe(200);
    });
  });

  describe('deactivate: business rules', () => {
    it('deactivates a clean lead with the actor from the signed-in user, in one transaction', async () => {
      const res = await deactivate('clean', {
        reason: '  Duplicate of an older enquiry  ',
      });
      expect(res.status).toBe(200);
      expect(inTransaction).toBe(true);
      expect(leads.clean).toMatchObject({
        isActive: false,
        deactivatedById: 'user-1',
        deactivationReason: 'Duplicate of an older enquiry',
      });
      expect(leads.clean.deactivatedAt).toBeInstanceOf(Date);
    });

    it('matches only an active lead with no opportunities and no PENDING follow-ups', async () => {
      await deactivate('clean');
      expect(calls.updateMany.where).toEqual({
        id: 'clean',
        isActive: true,
        opportunities: { none: {} },
        followups: { none: { status: 'PENDING' } },
      });
    });

    it('records LEAD_DEACTIVATED as an attributed SYSTEM event, not an employee activity', async () => {
      await deactivate('clean', { reason: 'Wrong number' });
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({
        leadId: 'clean',
        action: 'LEAD_DEACTIVATED',
        remarks: 'Wrong number',
        actorId: 'user-1',
      });
      expect(timeline[0].source).toBeUndefined();
      expect(timeline[0].activityType).toBeUndefined();
    });

    it('changes nothing except the lead and its timeline (follow-ups and opportunities untouched)', async () => {
      await deactivate('clean');
      expect(writes.sort()).toEqual(['lead.updateMany', 'leadTimeline.create']);
    });

    it('returns only { id, fullName } for the assignee and deactivator', async () => {
      await deactivate('clean');
      expect(calls.findOneInclude.assignedTo).toEqual({
        select: { id: true, fullName: true },
      });
      expect(calls.findOneInclude.deactivatedBy).toEqual({
        select: { id: true, fullName: true },
      });
    });

    it('allows a lead whose follow-ups are all completed or cancelled', async () => {
      expect((await deactivate('resolvedOnly')).status).toBe(200);
      expect(leads.resolvedOnly.isActive).toBe(false);
    });

    it.each([
      ['an unknown lead', 'nope', 404, 'Lead not found.'],
      [
        'an already deactivated lead',
        'inactive',
        409,
        'This lead is already deactivated.',
      ],
      [
        'a lead with an opportunity',
        'withOpp',
        409,
        "This lead can't be deactivated while it has 1 opportunity.",
      ],
      [
        'a lead with pending follow-ups',
        'withFollowups',
        409,
        "This lead can't be deactivated while it has 2 pending follow-ups.",
      ],
      [
        'a lead with both',
        'withBoth',
        409,
        "This lead can't be deactivated while it has 1 opportunity and 1 pending follow-up.",
      ],
    ])(
      'refuses %s (%i) with a clear message and changes nothing',
      async (_n, id, status, message) => {
        const before = JSON.stringify(leads[id] ?? null);
        const res = await deactivate(id);
        expect(res.status).toBe(status);
        expect(res.body.message).toBe(message);
        expect(writes).toEqual([]);
        expect(timeline).toEqual([]);
        expect(JSON.stringify(leads[id] ?? null)).toBe(before);
      },
    );
  });

  describe('locking (so the rules hold when requests overlap)', () => {
    it('deactivation takes the lead row exclusively, inside its transaction, before it checks anything', async () => {
      await deactivate('clean');
      expect(calls.locks).toEqual([
        {
          sql: 'SELECT "id" FROM "Lead" WHERE "id" = ? FOR UPDATE',
          id: 'clean',
          inTransaction: true,
        },
      ]);
    });

    it('an unknown lead is a 404 at the lock, before any update is attempted', async () => {
      db.lead.updateMany.mockClear();
      const res = await deactivate('nope');
      expect(res.status).toBe(404);
      expect(db.lead.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      [
        'create opportunity',
        () =>
          http().post('/opportunities').send({
            leadId: LEAD_UUID.clean,
            title: 'M',
            expectedValue: 1,
            probability: 1,
            expectedCloseDate: '2026-12-31',
          }),
      ],
      [
        'create follow-up',
        () =>
          http()
            .post('/lead-followups')
            .send({ leadId: 'clean', followupDate: '2026-12-01T10:00:00Z' }),
      ],
    ])(
      '%s takes a shared lock on the lead in the same transaction as its insert',
      async (_n, call) => {
        const res = await call();
        expect(res.status).toBe(201);
        expect(calls.locks).toEqual([
          {
            sql: 'SELECT "isActive" FROM "Lead" WHERE "id" = ? FOR SHARE',
            id: 'clean',
            inTransaction: true,
          },
        ]);
      },
    );

    it('the follow-up and opportunity creators still report a missing lead as 404', async () => {
      expect(
        (
          await http()
            .post('/lead-followups')
            .send({ leadId: 'nope', followupDate: '2026-12-01T10:00:00Z' })
        ).status,
      ).toBe(404);
      expect(
        (
          await http().post('/opportunities').send({
            leadId: LEAD_UUID.nope,
            title: 'M',
            expectedValue: 1,
            probability: 1,
            expectedCloseDate: '2026-12-31',
          })
        ).status,
      ).toBe(404);
      expect(writes).toEqual([]);
    });
  });

  describe('reactivate', () => {
    it('restores the lead to active and clears the three deactivation fields', async () => {
      const res = await reactivate('inactive');
      expect(res.status).toBe(200);
      expect(calls.updateMany.where).toEqual({
        id: 'inactive',
        isActive: false,
      });
      expect(leads.inactive).toMatchObject({
        isActive: true,
        deactivatedAt: null,
        deactivatedById: null,
        deactivationReason: null,
      });
    });

    it('records LEAD_REACTIVATED as an attributed SYSTEM event', async () => {
      await reactivate('inactive');
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({
        leadId: 'inactive',
        action: 'LEAD_REACTIVATED',
        remarks: 'Lead reactivated.',
        actorId: 'user-1',
      });
      expect(timeline[0].source).toBeUndefined();
    });

    it('does not reopen opportunities or touch follow-ups', async () => {
      await reactivate('inactive');
      expect(writes.sort()).toEqual(['lead.updateMany', 'leadTimeline.create']);
    });

    it.each([
      ['an unknown lead', 'nope', 404],
      ['an already active lead', 'clean', 409],
    ])('refuses %s (%i) and writes nothing', async (_n, id, status) => {
      const res = await reactivate(id);
      expect(res.status).toBe(status);
      expect(writes).toEqual([]);
      expect(timeline).toEqual([]);
    });

    it('round trip: deactivate then reactivate leaves the lead active with no leftovers', async () => {
      await deactivate('clean', { reason: 'Test' });
      await reactivate('clean');
      expect(leads.clean).toMatchObject({
        isActive: true,
        deactivatedAt: null,
        deactivatedById: null,
        deactivationReason: null,
      });
      expect(timeline.map((t) => t.action)).toEqual([
        'LEAD_DEACTIVATED',
        'LEAD_REACTIVATED',
      ]);
    });
  });

  describe('listing', () => {
    it('hides inactive leads by default', async () => {
      const res = await http().get('/leads');
      expect(res.status).toBe(200);
      expect(calls.findManyWhere).toEqual({ isActive: true });
      expect(res.body.map((l: FakeLead) => l.id)).not.toContain('inactive');
    });

    it('includes them with includeInactive=true', async () => {
      const res = await http().get('/leads?includeInactive=true');
      expect(calls.findManyWhere).toBeUndefined();
      expect(res.body.map((l: FakeLead) => l.id)).toContain('inactive');
    });

    it('includeInactive=false behaves like the default', async () => {
      await http().get('/leads?includeInactive=false');
      expect(calls.findManyWhere).toEqual({ isActive: true });
    });

    it.each(['maybe', '1', 'yes'])(
      'rejects includeInactive=%s and unknown parameters',
      async (v) => {
        expect((await http().get(`/leads?includeInactive=${v}`)).status).toBe(
          400,
        );
      },
    );

    it('rejects unknown query parameters', async () => {
      expect((await http().get('/leads?cacheBuster=1')).status).toBe(400);
    });

    it('lead detail still opens for a deactivated lead, with who deactivated it', async () => {
      const res = await http().get('/leads/inactive');
      expect(res.status).toBe(200);
      expect(res.body.isActive).toBe(false);
      expect(calls.findOneInclude.deactivatedBy).toEqual({
        select: { id: true, fullName: true },
      });
    });
  });

  describe('every normal sales write is refused on a deactivated lead', () => {
    const cases: [string, (id: string) => request.Test, number][] = [
      [
        'edit',
        (id) => http().patch(`/leads/${id}`).send({ customerName: 'New Name' }),
        200,
      ],
      [
        'log activity',
        (id) =>
          http()
            .post(`/leads/${id}/activities`)
            .send({ activityType: 'CALL', remarks: 'Spoke' }),
        201,
      ],
      [
        'assign',
        (id) =>
          http()
            .post('/lead-assignments')
            .send({ leadId: id, assignedToId: 'u9' }),
        201,
      ],
      [
        'qualify',
        (id) =>
          http()
            .patch(`/lead-assignments/${id}/qualify`)
            .send({ salesUserId: 'u9' }),
        200,
      ],
      [
        'reject',
        (id) =>
          http()
            .patch(`/lead-assignments/${id}/reject`)
            .send({ reason: 'No budget' }),
        200,
      ],
      [
        'status change',
        (id) =>
          http().post('/lead-status').send({ leadId: id, status: 'CONTACTED' }),
        201,
      ],
      [
        'create follow-up',
        (id) =>
          http().post('/lead-followups').send({
            leadId: id,
            followupDate: '2026-11-01T10:00:00Z',
            remarks: 'Call back',
          }),
        201,
      ],
      [
        'create opportunity',
        (id) =>
          http()
            .post('/opportunities')
            .send({
              leadId: LEAD_UUID[id] ?? id,
              title: 'Machine',
              expectedValue: 1000,
              probability: 50,
              expectedCloseDate: '2026-12-01',
            }),
        201,
      ],
    ];

    it.each(cases)(
      '%s: 409 with the standard message and no write',
      async (_n, call) => {
        const res = await call('inactive');
        expect(res.status).toBe(409);
        expect(res.body.message).toBe(LEAD_DEACTIVATED_MESSAGE);
        expect(writes).toEqual([]);
      },
    );

    it.each(cases)(
      '%s: unaffected for an active lead',
      async (_n, call, ok) => {
        const res = await call('clean');
        expect(res.status).toBe(ok);
        expect(writes.length).toBeGreaterThan(0);
      },
    );

    it.each(
      cases.filter(
        ([n]) => !['edit', 'log activity', 'create follow-up'].includes(n),
      ),
    )('%s: an unknown lead is a 404, not a server error', async (_n, call) => {
      const res = await call('nope');
      expect(res.status).toBe(404);
      expect(writes).toEqual([]);
    });

    it('reactivating makes the writes work again', async () => {
      await reactivate('inactive');
      writes = [];
      const res = await http()
        .patch('/leads/inactive')
        .send({ customerName: 'Back In Play' });
      expect(res.status).toBe(200);
    });
  });

  describe('follow-up complete, reschedule and cancel stay unchanged', () => {
    it('complete does not look at the lead (its own state checks already apply)', async () => {
      db.lead.findUnique.mockClear();
      const res = await http().patch('/lead-followups/f-pending/complete');
      expect(res.status).toBe(200);
      expect(db.lead.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('sales report counts', () => {
    it('funnel counts active leads only', async () => {
      const res = await http().get('/sales-reports/funnel');
      expect(res.status).toBe(200);
      expect(calls.countWhere).toEqual({ isActive: true });
      expect(res.body.leads).toBe(5);
    });

    it('lead-conversion counts active leads only', async () => {
      const res = await http().get('/sales-reports/lead-conversion');
      expect(calls.countWhere).toEqual({ isActive: true });
      expect(res.body.totalLeads).toBe(5);
      expect(res.body.conversionRate).toBe('60.00%');
    });
  });
});
