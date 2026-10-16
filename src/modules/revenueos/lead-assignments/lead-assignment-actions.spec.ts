/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { LEAD_DEACTIVATED_MESSAGE } from '../leads/lead-lifecycle';
import { LEAD_REJECT_REASON_MAX_LENGTH } from './dto/reject-lead.dto';
import { LeadAssignmentsController } from './lead-assignments.controller';
import { LeadAssignmentsModule } from './lead-assignments.module';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

// POST /lead-assignments, PATCH /lead-assignments/:id/qualify and /:id/reject through
// real HTTP: the real global JwtAuthGuard and JWT strategy, PermissionsGuard,
// ValidationPipe and service. The database is a small stateful double that records
// every call, so the order (lock first), the transaction and "nothing written on a
// refusal" are all visible. It has no update or delete for history rows, so touching
// earlier history fails the test.

const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const LEAD = '00000000-0000-4000-8000-0000000000b1';
const ASHA = '00000000-0000-4000-8000-0000000000c1';
const YASH = '00000000-0000-4000-8000-0000000000c2';
const GONE = '00000000-0000-4000-8000-0000000000c9';
const RETIRED = '00000000-0000-4000-8000-0000000000d1';
const BENCHED = '00000000-0000-4000-8000-0000000000d2';

const STATUSES = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'PRE_SALES_ASSIGNED',
  'QUALIFIED',
  'SALES_ASSIGNED',
  'PROPOSAL_SENT',
  'NEGOTIATION',
  'WON',
  'LOST',
  'REJECTED',
  'UNDERQUALIFIED',
] as const;
type Status = (typeof STATUSES)[number];

// The agreed matrix: which statuses each action may start from.
const ALLOWED: Record<'assign' | 'qualify' | 'reject', Status[]> = {
  assign: [
    'NEW',
    'ASSIGNED',
    'CONTACTED',
    'PRE_SALES_ASSIGNED',
    'UNDERQUALIFIED',
  ],
  // QUALIFIED without a hand-off to sales can still be handed over (it was stuck before).
  qualify: [
    'NEW',
    'ASSIGNED',
    'CONTACTED',
    'PRE_SALES_ASSIGNED',
    'UNDERQUALIFIED',
    'QUALIFIED',
  ],
  reject: [
    'NEW',
    'ASSIGNED',
    'CONTACTED',
    'PRE_SALES_ASSIGNED',
    'UNDERQUALIFIED',
    'QUALIFIED',
    'SALES_ASSIGNED',
    'PROPOSAL_SENT',
    'NEGOTIATION',
  ],
};

const USERS: Record<string, { fullName: string; status: string }> = {
  [ACTOR]: { fullName: 'Texzium Admin', status: 'ACTIVE' },
  [ASHA]: { fullName: 'Asha Rao', status: 'ACTIVE' },
  [YASH]: { fullName: 'Yash Kumar', status: 'ACTIVE' },
  [RETIRED]: { fullName: 'Retired User', status: 'INACTIVE' },
  [BENCHED]: { fullName: 'Benched User', status: 'SUSPENDED' },
};

interface FakeLead {
  status: Status;
  assignedToId: string | null;
  isActive: boolean;
}

function dbDouble(lead: FakeLead | null) {
  const state = { lead: lead ? { ...lead } : null, calls: [] as string[] };
  const db: any = {
    state,
    $queryRaw: jest.fn(async () => {
      state.calls.push('lock');
      return state.lead ? [{ isActive: state.lead.isActive }] : [];
    }),
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        state.calls.push(`user:${where.id}`);
        const u = USERS[where.id];
        return u ? { id: where.id, ...u } : null;
      }),
    },
    lead: {
      findUnique: jest.fn(async () => {
        state.calls.push('lead.read');
        if (!state.lead) return null;
        const assignee = state.lead.assignedToId
          ? USERS[state.lead.assignedToId]
          : undefined;
        return {
          status: state.lead.status,
          assignedToId: state.lead.assignedToId,
          assignedTo: assignee ? { fullName: assignee.fullName } : null,
        };
      }),
      update: jest.fn(async ({ data }: any) => {
        state.calls.push('lead.update');
        Object.assign(state.lead!, data);
        return { id: LEAD, ...state.lead };
      }),
    },
    leadTimeline: {
      create: jest.fn(async () => {
        state.calls.push('timeline.create');
        return {};
      }),
    },
  };
  db.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => {
    state.calls.push('begin');
    const result = await fn(db);
    state.calls.push('commit');
    return result;
  });
  return db;
}

function token(permissions: string[], sub: string = ACTOR) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub, email: 'actor@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

const PERMS = ['leads.assign', 'leads.qualify', 'leads.reject'];

describe('Lead assign / qualify / reject', () => {
  let app: INestApplication;
  let db: any;

  beforeAll(async () => {
    db = dbDouble(null);
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, LeadAssignmentsModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideGuard(RecordScopeGuard)
      .useValue(SCOPE_TESTED_ELSEWHERE)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
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
    await app?.close();
  });

  // Swaps the double's contents in place (the module holds the same object).
  const use = (lead: Partial<FakeLead> | null) => {
    const fresh = dbDouble(
      lead
        ? { status: 'NEW', assignedToId: null, isActive: true, ...lead }
        : null,
    );
    for (const key of Object.keys(fresh)) db[key] = fresh[key];
  };

  const send = (
    req: request.Test,
    body: object,
    permissions: string[] | null,
    sub?: string,
  ) => {
    if (permissions)
      req.set('Authorization', `Bearer ${token(permissions, sub)}`);
    return req.send(body);
  };
  const http = () => request(app.getHttpServer());
  const assign = (
    body: object = { leadId: LEAD, assignedToId: YASH },
    permissions: string[] | null = PERMS,
    sub?: string,
  ) => send(http().post('/lead-assignments'), body, permissions, sub);
  const qualify = (
    body: object = { salesUserId: YASH },
    permissions: string[] | null = PERMS,
    sub?: string,
  ) =>
    send(
      http().patch(`/lead-assignments/${LEAD}/qualify`),
      body,
      permissions,
      sub,
    );
  const reject = (
    body: object = { reason: 'No budget this year.' },
    permissions: string[] | null = PERMS,
    sub?: string,
  ) =>
    send(
      http().patch(`/lead-assignments/${LEAD}/reject`),
      body,
      permissions,
      sub,
    );

  const nothingWritten = () => {
    expect(db.lead.update).not.toHaveBeenCalled();
    expect(db.leadTimeline.create).not.toHaveBeenCalled();
  };
  const event = () => db.leadTimeline.create.mock.calls[0][0].data;

  beforeEach(() => use({}));

  it('declares one permission per action', () => {
    const p = LeadAssignmentsController.prototype;
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.assign)).toEqual([
      'leads.assign',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.qualifyLead)).toEqual([
      'leads.qualify',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, p.rejectLead)).toEqual([
      'leads.reject',
    ]);
  });

  describe('access', () => {
    const actions = [
      [
        'assign',
        'leads.assign',
        (p: any, s?: string) => assign(undefined, p, s),
        201,
      ],
      [
        'qualify',
        'leads.qualify',
        (p: any, s?: string) => qualify(undefined, p, s),
        200,
      ],
      [
        'reject',
        'leads.reject',
        (p: any, s?: string) => reject(undefined, p, s),
        200,
      ],
    ] as const;

    it.each(actions)('%s: 401 without a token', async (_n, _p, call) => {
      expect((await call(null)).status).toBe(401);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it.each(actions)(
      '%s: 403 without its own permission, even with every other lead permission',
      async (_n, perm, call) => {
        const others = [
          ...PERMS.filter((p) => p !== perm),
          'leads.view',
          'leads.edit',
          'leads.status.update',
        ];
        expect((await call(others)).status).toBe(403);
        expect(db.$transaction).not.toHaveBeenCalled();
      },
    );

    it.each(actions)(
      '%s: 401 when the signed-in user no longer exists, and nothing is written',
      async (_n, _p, call) => {
        expect((await call(PERMS, GONE)).status).toBe(401);
        nothingWritten();
      },
    );

    it.each(actions)(
      '%s: works with only its own permission',
      async (_n, perm, call, ok) => {
        expect((await call([perm])).status).toBe(ok);
      },
    );
  });

  describe('the actor is always the signed-in user', () => {
    const smuggled = [
      ['actorId', { actorId: ASHA }],
      ['actor', { actor: { id: ASHA } }],
      ['source', { source: 'EMPLOYEE' }],
      ['userRemark', { userRemark: 'sneaked in' }],
      ['remarks', { remarks: 'my own sentence' }],
      ['status', { status: 'WON' }],
      ['action', { action: 'LEAD_CREATED' }],
    ] as const;

    it.each(smuggled)(
      'refuses %s in the body of every action, writing nothing',
      async (_n, extra) => {
        for (const res of [
          await assign({ leadId: LEAD, assignedToId: YASH, ...extra }),
          await qualify({ salesUserId: YASH, ...extra }),
          await reject({ reason: 'No budget.', ...extra }),
        ]) {
          expect(res.status).toBe(400);
        }
        expect(db.$transaction).not.toHaveBeenCalled();
      },
    );

    it('records the token user as the actor on every event', async () => {
      await assign();
      expect(event().actorId).toBe(ACTOR);
      use({ status: 'PRE_SALES_ASSIGNED', assignedToId: YASH });
      await qualify();
      expect(event().actorId).toBe(ACTOR);
      use({ status: 'SALES_ASSIGNED', assignedToId: YASH });
      await reject();
      expect(event().actorId).toBe(ACTOR);
    });
  });

  describe('request validation (400, nothing reaches the database)', () => {
    it.each([
      ['no assignee', { leadId: LEAD }],
      ['an empty assignee', { leadId: LEAD, assignedToId: '' }],
      ['a non-string assignee', { leadId: LEAD, assignedToId: 7 }],
      ['no lead', { assignedToId: YASH }],
      ['an empty lead', { leadId: '', assignedToId: YASH }],
    ])('assign: %s', async (_n, body) => {
      expect((await assign(body)).status).toBe(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['no sales user', {}],
      ['an empty sales user', { salesUserId: '' }],
      ['a non-string sales user', { salesUserId: 7 }],
      ['an object as sales user', { salesUserId: { id: YASH } }],
    ])('qualify: %s', async (_n, body) => {
      expect((await qualify(body)).status).toBe(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['no reason', {}],
      ['an empty reason', { reason: '' }],
      ['a blank reason', { reason: '   \n\t ' }],
      ['a non-string reason', { reason: 5 }],
      ['an array reason', { reason: ['x'] }],
      [
        'a reason over the limit',
        { reason: 'x'.repeat(LEAD_REJECT_REASON_MAX_LENGTH + 1) },
      ],
    ])('reject: %s', async (_n, body) => {
      expect((await reject(body)).status).toBe(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('reject: a reason at the limit after trimming is accepted, stored trimmed', async () => {
      const reason = 'x'.repeat(LEAD_REJECT_REASON_MAX_LENGTH);
      const res = await reject({ reason: `  ${reason}\n` });
      expect(res.status).toBe(200);
      expect(event().userRemark).toBe(reason);
    });
  });

  describe('the transition matrix (all 12 statuses)', () => {
    const cases = (['assign', 'qualify', 'reject'] as const).flatMap((action) =>
      STATUSES.map(
        (from) => [action, from, ALLOWED[action].includes(from)] as const,
      ),
    );

    it.each(cases)('%s from %s: allowed=%s', async (action, from, allowed) => {
      // A pre-sales lead is held by Asha, so assigning it to Yash is a reassignment.
      use({ status: from, assignedToId: from === 'NEW' ? null : ASHA });
      const res =
        action === 'assign'
          ? await assign()
          : action === 'qualify'
            ? await qualify()
            : await reject();

      if (allowed) {
        expect(res.status).toBe(action === 'assign' ? 201 : 200);
        expect(db.state.lead.status).toBe(
          {
            assign: 'PRE_SALES_ASSIGNED',
            qualify: 'SALES_ASSIGNED',
            reject: 'REJECTED',
          }[action],
        );
        expect(db.leadTimeline.create).toHaveBeenCalledTimes(1);
        expect(db.lead.update).toHaveBeenCalledTimes(1);
      } else {
        expect(res.status).toBe(409);
        expect(db.state.lead.status).toBe(from);
        nothingWritten();
      }
    });

    it('refusal messages name the reason', async () => {
      use({ status: 'WON' });
      expect((await assign()).body.message).toBe(
        'This lead is closed (Won), so it cannot be assigned to pre-sales.',
      );
      expect((await qualify()).body.message).toBe(
        'This lead is closed (Won), so it cannot be qualified.',
      );
      expect((await reject()).body.message).toBe(
        'This lead is closed (Won), so it cannot be rejected.',
      );
      use({ status: 'SALES_ASSIGNED', assignedToId: YASH });
      expect((await assign()).body.message).toBe(
        'This lead has already been qualified (Sales Assigned), so it cannot be assigned to pre-sales.',
      );
      expect((await qualify()).body.message).toBe(
        'This lead has already been qualified (Sales Assigned).',
      );
      use({ status: 'REJECTED' });
      expect((await reject()).body.message).toBe(
        'This lead has already been rejected.',
      );
    });
  });

  describe('history events', () => {
    it('assign: one PRE_SALES_ASSIGNED event, SYSTEM, the actor, the assignee by name', async () => {
      const res = await assign();
      expect(res.status).toBe(201);
      expect(db.lead.update).toHaveBeenCalledWith({
        where: { id: LEAD },
        data: { assignedToId: YASH, status: 'PRE_SALES_ASSIGNED' },
      });
      expect(db.leadTimeline.create).toHaveBeenCalledWith({
        data: {
          leadId: LEAD,
          action: 'PRE_SALES_ASSIGNED',
          remarks: 'Assigned to pre-sales: Yash Kumar.',
          source: 'SYSTEM',
          actorId: ACTOR,
          subjectUserId: YASH,
        },
      });
    });

    it('assign: a reassignment names who held the lead before', async () => {
      use({ status: 'PRE_SALES_ASSIGNED', assignedToId: ASHA });
      expect((await assign()).status).toBe(201);
      expect(event().remarks).toBe(
        'Assigned to pre-sales: Yash Kumar (previously Asha Rao).',
      );
    });

    it('assign: reassigning to the current pre-sales assignee is a 409', async () => {
      use({ status: 'PRE_SALES_ASSIGNED', assignedToId: YASH });
      const res = await assign();
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        'This lead is already assigned to Yash Kumar.',
      );
      nothingWritten();
    });

    it('assign: a lead not yet in pre-sales whose assignee is the same person moves to pre-sales without "previously"', async () => {
      use({ status: 'CONTACTED', assignedToId: YASH });
      expect((await assign()).status).toBe(201);
      expect(event().remarks).toBe('Assigned to pre-sales: Yash Kumar.');
    });

    it('qualify: one LEAD_QUALIFIED event naming the sales user and the pre-sales user before', async () => {
      use({ status: 'PRE_SALES_ASSIGNED', assignedToId: ASHA });
      expect((await qualify()).status).toBe(200);
      expect(db.lead.update).toHaveBeenCalledWith({
        where: { id: LEAD },
        data: { assignedToId: YASH, status: 'SALES_ASSIGNED' },
      });
      expect(db.leadTimeline.create).toHaveBeenCalledWith({
        data: {
          leadId: LEAD,
          action: 'LEAD_QUALIFIED',
          remarks:
            'Qualified and assigned to sales: Yash Kumar (previously Asha Rao).',
          source: 'SYSTEM',
          actorId: ACTOR,
          subjectUserId: YASH,
        },
      });
    });

    it('qualify: to the current assignee, or with no assignee, there is no "previously"', async () => {
      use({ status: 'PRE_SALES_ASSIGNED', assignedToId: YASH });
      await qualify();
      expect(event().remarks).toBe(
        'Qualified and assigned to sales: Yash Kumar.',
      );
      use({ status: 'NEW' });
      await qualify();
      expect(event().remarks).toBe(
        'Qualified and assigned to sales: Yash Kumar.',
      );
    });

    it('reject: one LEAD_REJECTED event, the fixed sentence, the reason as the remark, the assignee kept', async () => {
      use({ status: 'SALES_ASSIGNED', assignedToId: YASH });
      expect(
        (await reject({ reason: '  No budget this year.  ' })).status,
      ).toBe(200);
      expect(db.lead.update).toHaveBeenCalledWith({
        where: { id: LEAD },
        data: { status: 'REJECTED' },
      });
      expect(db.state.lead.assignedToId).toBe(YASH);
      expect(db.leadTimeline.create).toHaveBeenCalledWith({
        data: {
          leadId: LEAD,
          action: 'LEAD_REJECTED',
          remarks: 'Lead rejected.',
          userRemark: 'No budget this year.',
          source: 'SYSTEM',
          actorId: ACTOR,
        },
      });
    });
  });

  describe('assignees', () => {
    it.each([
      ['assign', () => assign({ leadId: LEAD, assignedToId: GONE })],
      ['qualify', () => qualify({ salesUserId: GONE })],
    ])('%s: a user that does not exist is a 400', async (_n, call) => {
      const res = await call();
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('The selected user does not exist.');
      nothingWritten();
    });

    it.each([
      [
        'assign',
        'INACTIVE',
        () => assign({ leadId: LEAD, assignedToId: RETIRED }),
      ],
      [
        'assign',
        'SUSPENDED',
        () => assign({ leadId: LEAD, assignedToId: BENCHED }),
      ],
      ['qualify', 'INACTIVE', () => qualify({ salesUserId: RETIRED })],
      ['qualify', 'SUSPENDED', () => qualify({ salesUserId: BENCHED })],
    ])('%s: an %s user is a 409', async (_n, _s, call) => {
      const res = await call();
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(
        'The selected user is not active and cannot take leads.',
      );
      nothingWritten();
    });
  });

  describe('the lead itself', () => {
    const all = [
      ['assign', () => assign()],
      ['qualify', () => qualify()],
      ['reject', () => reject()],
    ] as const;

    it.each(all)(
      '%s: 404 for a lead that does not exist (or was deleted)',
      async (_n, call) => {
        use(null);
        expect((await call()).status).toBe(404);
        nothingWritten();
      },
    );

    it.each(all)(
      '%s: 409 for a deactivated lead, with the standard message',
      async (_n, call) => {
        use({ isActive: false });
        const res = await call();
        expect(res.status).toBe(409);
        expect(res.body.message).toBe(LEAD_DEACTIVATED_MESSAGE);
        nothingWritten();
      },
    );

    it.each(all)(
      '%s: lock first, every read and write inside one transaction',
      async (_n, call) => {
        use({ status: 'PRE_SALES_ASSIGNED', assignedToId: ASHA });
        await call();
        const calls: string[] = db.state.calls;
        expect(calls[0]).toBe('begin');
        expect(calls[1]).toBe('lock');
        expect(calls[calls.length - 1]).toBe('commit');
        expect(calls.slice(-3, -1)).toEqual(['lead.update', 'timeline.create']);
      },
    );
  });

  describe('duplicates, one after the other (the lock serialises them)', () => {
    it('a second qualification is a 409', async () => {
      use({ status: 'PRE_SALES_ASSIGNED', assignedToId: ASHA });
      expect((await qualify()).status).toBe(200);
      const calls = db.leadTimeline.create.mock.calls.length;
      expect((await qualify()).status).toBe(409);
      expect(db.leadTimeline.create.mock.calls.length).toBe(calls);
    });

    it('a second rejection is a 409', async () => {
      expect((await reject()).status).toBe(200);
      expect((await reject()).status).toBe(409);
      expect(db.leadTimeline.create).toHaveBeenCalledTimes(1);
    });

    it('assigning the same person twice is a 409 the second time', async () => {
      expect((await assign()).status).toBe(201);
      expect((await assign()).status).toBe(409);
      expect(db.leadTimeline.create).toHaveBeenCalledTimes(1);
    });

    it('nothing can be assigned or qualified after a rejection', async () => {
      expect((await reject()).status).toBe(200);
      expect((await assign()).status).toBe(409);
      expect((await qualify()).status).toBe(409);
      expect(db.leadTimeline.create).toHaveBeenCalledTimes(1);
    });
  });
});
