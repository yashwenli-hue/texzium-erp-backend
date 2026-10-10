/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import * as fs from 'fs';
import * as path from 'path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { OPPORTUNITY_STAGE_REMARK_MAX_LENGTH } from './opportunity-stage';

const LEAD_ID = '11111111-1111-4111-8111-111111111111';
const OPP_ID = 'opp-1';
const SENTENCE =
  'Opportunity "Hydraulic Systems Upgrade": Qualified → Proposal';

describe('Opportunity stage remark', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] };
  let status: string;
  let timeline: any[];
  let writes: string[];
  let order: string[];
  let inTransaction: boolean;
  let timelineInTransaction: boolean[];

  const db: any = {
    opportunity: {
      findUnique: jest.fn(async (args: any) => {
        if (args.where.id !== OPP_ID) return null;
        const row = {
          id: OPP_ID,
          leadId: LEAD_ID,
          title: 'Hydraulic Systems Upgrade',
          status,
        };
        return args.select
          ? Object.fromEntries(
              Object.keys(args.select).map((k) => [k, (row as any)[k]]),
            )
          : row;
      }),
      updateMany: jest.fn(async (args: any) => {
        order.push('opportunity.updateMany');
        if (args.where.status !== status) return { count: 0 };
        status = args.data.status;
        writes.push('opportunity.updateMany');
        return { count: 1 };
      }),
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
        timelineInTransaction.push(inTransaction);
        timeline.push(args.data);
        return { id: 'tl', ...args.data };
      }),
    },
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, id: string) => {
      order.push('lead.lock');
      return [{ id, isActive: true }];
    }),
    $transaction: jest.fn(async (arg: any) => {
      inTransaction = true;
      try {
        return await arg(db);
      } finally {
        inTransaction = false;
      }
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
    jest.clearAllMocks();
    user = {
      id: 'user-1',
      permissions: ['opportunities.view', 'opportunities.edit'],
    };
    status = 'QUALIFIED';
    timeline = [];
    writes = [];
    order = [];
    inTransaction = false;
    timelineInTransaction = [];
  });

  const move = (body: object, id = OPP_ID) =>
    request(app.getHttpServer()).patch(`/opportunities/${id}/stage`).send(body);
  const toProposal = (extra: object = {}) =>
    move({ fromStage: 'QUALIFIED', toStage: 'PROPOSAL', ...extra });

  it('has a limit of 500 characters', () => {
    expect(OPPORTUNITY_STAGE_REMARK_MAX_LENGTH).toBe(500);
  });

  describe('storing the remark', () => {
    it('puts it on the one stage event, apart from the system sentence, in the same transaction', async () => {
      const res = await toProposal({
        remarks: 'Customer asked for a revised quote by Friday.',
      });
      expect(res.status).toBe(200);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]).toMatchObject({
        leadId: LEAD_ID,
        action: 'OPPORTUNITY_STAGE_CHANGED',
        remarks: SENTENCE,
        userRemark: 'Customer asked for a revised quote by Friday.',
        actorId: 'user-1',
      });
      expect(timelineInTransaction).toEqual([true]);
      expect(order).toEqual([
        'lead.lock',
        'opportunity.updateMany',
        'leadTimeline.create',
      ]);
    });

    it('keeps the system sentence exactly as before whether or not there is a remark', async () => {
      await toProposal({ remarks: 'a' });
      status = 'QUALIFIED';
      await toProposal();
      expect(timeline.map((t) => t.remarks)).toEqual([SENTENCE, SENTENCE]);
    });

    it('stores null when there is no remark, a blank one, or only whitespace and line breaks', async () => {
      for (const body of [
        {},
        { remarks: '' },
        { remarks: '    ' },
        { remarks: '\n\t \r\n' },
      ]) {
        timeline = [];
        status = 'QUALIFIED';
        const res = await toProposal(body);
        expect(res.status).toBe(200);
        expect(timeline).toHaveLength(1);
        expect(timeline[0].userRemark).toBeNull();
      }
    });

    it('trims the ends and keeps everything inside (line breaks, spacing, symbols, non-Latin text)', async () => {
      const text = 'Line one\n\nLine  two — ₹5,00,000 “agreed” 日本語 😀';
      await toProposal({ remarks: `  \n${text}\t ` });
      expect(timeline[0].userRemark).toBe(text);
    });

    it('accepts exactly 500 characters (after trimming) and refuses 501', async () => {
      const ok = await toProposal({ remarks: `  ${'x'.repeat(500)}  ` });
      expect(ok.status).toBe(200);
      expect(timeline[0].userRemark).toBe('x'.repeat(500));

      timeline = [];
      writes = [];
      status = 'QUALIFIED';
      const tooLong = await toProposal({ remarks: 'x'.repeat(501) });
      expect(tooLong.status).toBe(400);
      expect(writes).toEqual([]);
      expect(status).toBe('QUALIFIED');
    });

    it.each([
      ['a number', 5],
      ['an object', { text: 'x' }],
      ['an array', ['x']],
      ['a boolean', true],
    ])('refuses %s as the remark and writes nothing', async (_n, remarks) => {
      const res = await toProposal({ remarks });
      expect(res.status).toBe(400);
      expect(writes).toEqual([]);
    });

    it('stores a remark on every kind of move: forward, back, Won and Lost', async () => {
      const steps: [string, string, string][] = [
        ['QUALIFIED', 'PROPOSAL', 'fwd'],
        ['PROPOSAL', 'QUALIFIED', 'back'],
        ['QUALIFIED', 'LOST', 'lost'],
      ];
      for (const [from, to, text] of steps) {
        status = from;
        timeline = [];
        expect(
          (await move({ fromStage: from, toStage: to, remarks: text })).status,
        ).toBe(200);
        expect(timeline[0].userRemark).toBe(text);
      }
      status = 'NEGOTIATION';
      timeline = [];
      expect(
        (
          await move({
            fromStage: 'NEGOTIATION',
            toStage: 'WON',
            remarks: 'Signed.',
          })
        ).status,
      ).toBe(200);
      expect(timeline[0].userRemark).toBe('Signed.');
    });
  });

  describe('a remark never gets through when the move does not happen', () => {
    it('writes no event for a stale screen (409), a refused move (400) or an unknown opportunity (404)', async () => {
      status = 'PROPOSAL';
      const stale = await toProposal({ remarks: 'stale' });
      expect(stale.status).toBe(409);

      status = 'QUALIFIED';
      const skip = await move({
        fromStage: 'QUALIFIED',
        toStage: 'WON',
        remarks: 'skipping',
      });
      expect(skip.status).toBe(400);

      const missing = await move(
        { fromStage: 'QUALIFIED', toStage: 'PROPOSAL', remarks: 'nobody' },
        'nope',
      );
      expect(missing.status).toBe(404);

      expect(timeline).toEqual([]);
      expect(writes).toEqual([]);
    });

    it('keeps the permission and sign-in rules: 403 without opportunities.edit, 401 without a user', async () => {
      user = { id: 'user-1', permissions: ['opportunities.view'] };
      expect((await toProposal({ remarks: 'x' })).status).toBe(403);
      user = { permissions: ['opportunities.edit'] };
      expect((await toProposal({ remarks: 'x' })).status).toBe(401);
      user = { id: 'ghost', permissions: ['opportunities.edit'] };
      expect((await toProposal({ remarks: 'x' })).status).toBe(401);
      expect(timeline).toEqual([]);
    });
  });

  describe('the actor is always the signed-in user', () => {
    it.each([
      ['actorId', { actorId: 'someone-else' }],
      ['actorName', { actorName: 'Someone Else' }],
      ['actorEmail', { actorEmail: 'x@y.z' }],
      ['actor', { actor: { id: 'x' } }],
      ['recordedBy', { recordedBy: 'x' }],
      ['source', { source: 'EMPLOYEE' }],
      ['the column itself (userRemark)', { userRemark: 'sneaked in' }],
      ['the system sentence (remark)', { remark: 'x' }],
    ])(
      'rejects %s from the client, with or without a remark, and writes nothing',
      async (_n, extra) => {
        expect((await toProposal({ remarks: 'fine', ...extra })).status).toBe(
          400,
        );
        expect((await toProposal(extra)).status).toBe(400);
        expect(writes).toEqual([]);
      },
    );

    it('records the authenticated user as the actor, whatever the remark says', async () => {
      user = { id: 'user-1', permissions: ['opportunities.edit'] };
      await toProposal({ remarks: 'I am actually user-2' });
      expect(timeline[0].actorId).toBe('user-1');
    });
  });

  describe('where the remark is written', () => {
    const src = (rel: string) =>
      fs.readFileSync(path.join(__dirname, '../../..', rel), 'utf8');

    it('is written by updateStage and the lead unassignment only; every other timeline writer leaves userRemark alone', () => {
      const writers = [
        'modules/revenueos/leads/leads.service.ts',
        'modules/revenueos/lead-status/lead-status.service.ts',
        'modules/revenueos/lead-followups/lead-followups.service.ts',
        'modules/adminos/webhooks/webhooks.service.ts',
        'core/whatsapp/whatsapp.service.ts',
      ];
      for (const rel of writers) expect(src(rel)).not.toMatch(/userRemark/);
      expect(
        src('modules/revenueos/opportunities/opportunities.service.ts').match(
          /userRemark/g,
        ),
      ).toHaveLength(1);

      // The assignment service writes it once, in unassign (LEAD_UNASSIGNED); assign,
      // qualify and reject leave it alone.
      const assignments = src(
        'modules/revenueos/lead-assignments/lead-assignments.service.ts',
      );
      expect(assignments.match(/userRemark/g)).toHaveLength(1);
      expect(assignments.indexOf('userRemark')).toBeGreaterThan(
        assignments.indexOf('async unassign('),
      );
      expect(assignments.indexOf('async unassign(')).toBeGreaterThan(
        assignments.indexOf('async rejectLead('),
      );
    });
  });
});
