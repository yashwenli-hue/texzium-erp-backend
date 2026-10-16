/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { OpportunitiesController } from '../opportunities/opportunities.controller';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const PERMISSIONS = ['leads.edit', 'leads.view', 'opportunities.view'];

describe('Lead activity (attributed employee history on LeadTimeline)', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] };
  let creates: any[];
  let updates: any[];
  let lastFindOneArgs: any;
  let lastOpportunityArgs: any;

  const prismaStub = {
    lead: {
      findUnique: jest.fn(async (args: any) => {
        if (args.include) lastFindOneArgs = args;
        return args.where.id === 'lead1'
          ? { id: 'lead1', isActive: true, timelines: [], notes: [] }
          : null;
      }),
      update: jest.fn(async (args: any) => {
        updates.push(args);
        return { id: args.where.id };
      }),
    },
    user: {
      findUnique: jest.fn(async (args: any) =>
        args.where.id === 'user-1' ? { id: 'user-1' } : null,
      ),
    },
    leadTimeline: {
      create: jest.fn(async (args: any) => {
        creates.push(args);
        return {
          id: 'tl1',
          ...args.data,
          createdAt: new Date(),
          actor: { id: args.data.actorId, fullName: 'Rohit M.' },
        };
      }),
    },
    opportunity: {
      findUnique: jest.fn(async (args: any) => {
        lastOpportunityArgs = args;
        return args.where.id === 'opp1' ? { id: 'opp1' } : null;
      }),
    },
    // The activity is written in a transaction under the shared lock on the lead
    // (FOR SHARE); the lead exists and is active for 'lead1'.
    $queryRaw: jest.fn(async () => [{ id: 'lead1', isActive: true }]),
    $transaction: jest.fn(async (arg: any) =>
      typeof arg === 'function' ? arg(prismaStub) : Promise.all(arg),
    ),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LeadsController, OpportunitiesController],
      providers: [
        LeadsService,
        OpportunitiesService,
        { provide: PrismaService, useValue: prismaStub },
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

  beforeEach(() => {
    user = { id: 'user-1', permissions: PERMISSIONS };
    creates = [];
    updates = [];
    lastFindOneArgs = undefined;
    lastOpportunityArgs = undefined;
  });

  const post = (body: unknown, leadId = 'lead1') =>
    request(app.getHttpServer())
      .post(`/leads/${leadId}/activities`)
      .send(body as object);

  it('records an EMPLOYEE entry with the actor taken from the authenticated user', async () => {
    const res = await post({ activityType: 'CALL', remarks: 'Spoke to buyer' });

    expect(res.status).toBe(201);
    expect(creates).toHaveLength(1);
    expect(creates[0].data).toMatchObject({
      leadId: 'lead1',
      source: 'EMPLOYEE',
      activityType: 'CALL',
      action: 'ACTIVITY_CALL',
      remarks: 'Spoke to buyer',
      actorId: 'user-1',
    });
    expect(res.body.actor).toEqual({ id: 'user-1', fullName: 'Rohit M.' });
  });

  it('selects only id and fullName for the actor', async () => {
    await post({ activityType: 'NOTE', remarks: 'x' });
    expect(creates[0].include).toEqual({
      actor: { select: { id: true, fullName: true } },
    });
  });

  it('touches the lead updatedAt in the same transaction and never changes status', async () => {
    await post({ activityType: 'EMAIL', remarks: 'Sent brochure' });
    expect(prismaStub.$transaction).toHaveBeenCalled();
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0].data)).toEqual(['updatedAt']);
  });

  it('trims remarks and defaults occurredAt to now', async () => {
    const res = await post({ activityType: 'NOTE', remarks: '  hello  ' });
    expect(res.status).toBe(201);
    expect(creates[0].data.remarks).toBe('hello');
    expect(
      Math.abs(Date.now() - creates[0].data.occurredAt.getTime()),
    ).toBeLessThan(5000);
  });

  it('accepts a past occurredAt and stores it', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const res = await post({
      activityType: 'MEETING',
      remarks: 'Site visit',
      occurredAt: past,
    });
    expect(res.status).toBe(201);
    expect(creates[0].data.occurredAt.toISOString()).toBe(past);
  });

  it.each([
    ['empty remarks', { activityType: 'NOTE', remarks: '' }],
    ['whitespace-only remarks', { activityType: 'NOTE', remarks: '  \n\t ' }],
    ['over-long remarks', { activityType: 'NOTE', remarks: 'x'.repeat(2001) }],
    ['non-string remarks', { activityType: 'NOTE', remarks: 5 }],
    ['unknown activityType', { activityType: 'SHOUT', remarks: 'x' }],
    [
      'system lifecycle code as activityType',
      { activityType: 'LEAD_QUALIFIED', remarks: 'forged' },
    ],
    [
      'client-supplied action',
      { activityType: 'CALL', remarks: 'x', action: 'LEAD_QUALIFIED' },
    ],
    [
      'client-supplied source',
      { activityType: 'CALL', remarks: 'x', source: 'SYSTEM' },
    ],
    [
      'client-supplied actorId (impersonation)',
      { activityType: 'CALL', remarks: 'x', actorId: 'someone-else' },
    ],
    [
      'future occurredAt',
      {
        activityType: 'CALL',
        remarks: 'x',
        occurredAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    ],
    [
      'invalid occurredAt',
      { activityType: 'CALL', remarks: 'x', occurredAt: 'yesterday' },
    ],
  ])('rejects %s without writing anything', async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(creates).toHaveLength(0);
  });

  it('accepts remarks of exactly the maximum length', async () => {
    const res = await post({ activityType: 'NOTE', remarks: 'y'.repeat(2000) });
    expect(res.status).toBe(201);
  });

  it('returns 404 for an unknown lead and writes nothing', async () => {
    const res = await post({ activityType: 'CALL', remarks: 'x' }, 'nope');
    expect(res.status).toBe(404);
    expect(creates).toHaveLength(0);
  });

  it('requires the leads.edit permission', async () => {
    user = { id: 'user-1', permissions: ['leads.view'] };
    const res = await post({ activityType: 'CALL', remarks: 'x' });
    expect(res.status).toBe(403);
    expect(creates).toHaveLength(0);
  });

  it('rejects an authenticated request that carries no user id', async () => {
    user = { permissions: PERMISSIONS };
    const res = await post({ activityType: 'CALL', remarks: 'x' });
    expect(res.status).toBe(401);
    expect(creates).toHaveLength(0);
  });

  it('rejects a token for a user that no longer exists', async () => {
    user = { id: 'ghost', permissions: PERMISSIONS };
    const res = await post({ activityType: 'CALL', remarks: 'x' });
    expect(res.status).toBe(401);
    expect(creates).toHaveLength(0);
  });

  it('no longer exposes the superseded notes and timeline write routes', async () => {
    const notes = await request(app.getHttpServer())
      .post('/leads/lead1/notes')
      .send({ note: 'x' });
    const timeline = await request(app.getHttpServer())
      .post('/leads/lead1/timeline')
      .send({ action: 'LEAD_QUALIFIED', remarks: 'forged' });
    expect(notes.status).toBe(404);
    expect(timeline.status).toBe(404);
  });

  describe('history retrieval', () => {
    const expectedTimelines = {
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: { actor: { select: { id: true, fullName: true } } },
    };

    it('GET /leads/:id orders timelines and notes deterministically with a safe actor', async () => {
      const res = await request(app.getHttpServer()).get('/leads/lead1');
      expect(res.status).toBe(200);
      expect(lastFindOneArgs.include.timelines).toEqual(expectedTimelines);
      expect(lastFindOneArgs.include.notes).toEqual({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    });

    it('GET /opportunities/:id embeds the same history and selects a safe assignee', async () => {
      const res = await request(app.getHttpServer()).get('/opportunities/opp1');
      expect(res.status).toBe(200);
      const lead = lastOpportunityArgs.include.lead.include;
      expect(lead.timelines).toEqual(expectedTimelines);
      expect(lead.assignedTo).toEqual({
        select: { id: true, fullName: true },
      });
    });

    it('GET /opportunities/:id returns 404 for an unknown opportunity', async () => {
      const res = await request(app.getHttpServer()).get('/opportunities/nope');
      expect(res.status).toBe(404);
    });
  });
});
