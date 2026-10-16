/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/unbound-method -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { LeadAssignmentsController } from './lead-assignments.controller';
import { LeadAssignmentsModule } from './lead-assignments.module';
import { LEAD_UNASSIGN_REMARK_MAX_LENGTH } from './dto/unassign-lead.dto';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

// PATCH /lead-assignments/:id/unassign through real HTTP: the real global JwtAuthGuard
// and JWT strategy, PermissionsGuard, ValidationPipe and service. The database is a
// recording double: it has no update or delete for history rows, so touching earlier
// history fails the test.

const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const LEAD = '00000000-0000-4000-8000-0000000000b1';
const ASSIGNEE = '00000000-0000-4000-8000-0000000000c1';

function dbDouble(
  lead: Record<string, unknown> | null,
  lock: unknown[] = [{ isActive: true }],
) {
  const db: any = {
    $queryRaw: jest.fn().mockResolvedValue(lock),
    user: { findUnique: jest.fn().mockResolvedValue({ id: ACTOR }) },
    lead: {
      findUnique: jest.fn().mockResolvedValue(lead),
      update: jest.fn(({ data }: any) =>
        Promise.resolve({ id: LEAD, customerName: 'Test', ...lead, ...data }),
      ),
    },
    leadTimeline: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));
  return db;
}

const ASSIGNED = {
  status: 'PRE_SALES_ASSIGNED',
  assignedToId: ASSIGNEE,
  assignedTo: { fullName: 'Yash Kumar' },
};

function token(permissions: string[]) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: ACTOR, email: 'actor@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

describe('PATCH /lead-assignments/:id/unassign', () => {
  let app: INestApplication;
  let db: any;

  beforeAll(async () => {
    db = dbDouble(ASSIGNED);
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

  const use = (lead: Record<string, unknown> | null, lock?: unknown[]) => {
    const fresh = dbDouble(lead, lock);
    for (const key of Object.keys(fresh)) db[key] = fresh[key];
    db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));
  };

  const unassign = (
    body: object = { assignedToId: ASSIGNEE },
    permissions: string[] | null = ['leads.assign'],
    id = LEAD,
  ) => {
    const req = request(app.getHttpServer()).patch(
      `/lead-assignments/${id}/unassign`,
    );
    if (permissions) req.set('Authorization', `Bearer ${token(permissions)}`);
    return req.send(body);
  };

  const nothingWritten = () => {
    expect(db.lead.update).not.toHaveBeenCalled();
    expect(db.leadTimeline.create).not.toHaveBeenCalled();
  };

  beforeEach(() => use(ASSIGNED));

  it('declares leads.assign', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        LeadAssignmentsController.prototype.unassign,
      ),
    ).toEqual(['leads.assign']);
  });

  describe('access', () => {
    it('is 401 without a token', async () => {
      expect((await unassign(undefined, null)).status).toBe(401);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('is 403 without leads.assign, even with every other lead permission', async () => {
      const res = await unassign(undefined, [
        'leads.view',
        'leads.edit',
        'leads.qualify',
        'leads.reject',
        'leads.status.update',
      ]);
      expect(res.status).toBe(403);
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('is 401 when the signed-in user no longer exists', async () => {
      db.user.findUnique.mockResolvedValueOnce(null);
      expect((await unassign()).status).toBe(401);
      nothingWritten();
    });
  });

  describe('a pre-sales assignment is undone', () => {
    it('clears the assignee and returns the lead to NEW, in one transaction under the lock', async () => {
      const res = await unassign();

      expect(res.status).toBe(200);
      expect(db.$queryRaw).toHaveBeenCalledTimes(1);
      expect(db.lead.update).toHaveBeenCalledWith({
        where: { id: LEAD },
        data: { assignedToId: null, status: 'NEW' },
      });
      expect(res.body).toMatchObject({
        id: LEAD,
        assignedToId: null,
        status: 'NEW',
      });
    });

    it('records exactly one LEAD_UNASSIGNED event: SYSTEM, the actor, the assignee by name', async () => {
      await unassign();

      expect(db.leadTimeline.create).toHaveBeenCalledTimes(1);
      expect(db.leadTimeline.create).toHaveBeenCalledWith({
        data: {
          leadId: LEAD,
          action: 'LEAD_UNASSIGNED',
          remarks: 'Unassigned from Yash Kumar; status returned to New.',
          userRemark: null,
          source: 'SYSTEM',
          actorId: ACTOR,
          subjectUserId: ASSIGNEE,
        },
      });
    });

    it('stores the remark trimmed, and a blank remark as none', async () => {
      await unassign({
        assignedToId: ASSIGNEE,
        remarks: '  Assigned by mistake.  ',
      });
      expect(db.leadTimeline.create.mock.calls[0][0].data.userRemark).toBe(
        'Assigned by mistake.',
      );

      use(ASSIGNED);
      await unassign({ assignedToId: ASSIGNEE, remarks: '   ' });
      expect(
        db.leadTimeline.create.mock.calls[0][0].data.userRemark,
      ).toBeNull();
    });

    it('accepts a remark at the length limit', async () => {
      const res = await unassign({
        assignedToId: ASSIGNEE,
        remarks: 'x'.repeat(LEAD_UNASSIGN_REMARK_MAX_LENGTH),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('refusals write nothing', () => {
    it.each([
      'NEW',
      'CONTACTED',
      'ASSIGNED',
      'QUALIFIED',
      'SALES_ASSIGNED',
      'REJECTED',
      'WON',
      'LOST',
    ])('409 for a lead in %s', async (status) => {
      use({ ...ASSIGNED, status });
      const res = await unassign();
      expect(res.status).toBe(409);
      nothingWritten();
    });

    it('409 for PRE_SALES_ASSIGNED without an assignee', async () => {
      use({ ...ASSIGNED, assignedToId: null, assignedTo: null });
      expect((await unassign()).status).toBe(409);
      nothingWritten();
    });

    it('409 when the lead has since been assigned to someone else (stale screen)', async () => {
      const res = await unassign({ assignedToId: 'someone-else' });
      expect(res.status).toBe(409);
      expect(res.body.message).toContain('assignment has changed');
      nothingWritten();
    });

    it('404 for a lead that does not exist (or was deleted)', async () => {
      use(null, []);
      expect((await unassign()).status).toBe(404);
      nothingWritten();
    });

    it('409 for a deactivated lead', async () => {
      use(ASSIGNED, [{ isActive: false }]);
      expect((await unassign()).status).toBe(409);
      nothingWritten();
    });

    it.each([
      ['no assignee', {}],
      ['an empty assignee', { assignedToId: '' }],
      ['an assignee that is not a string', { assignedToId: { id: ASSIGNEE } }],
      ['an unknown field', { assignedToId: ASSIGNEE, actorId: 'x' }],
      ['a status in the body', { assignedToId: ASSIGNEE, status: 'CONTACTED' }],
      ['a remark that is not a string', { assignedToId: ASSIGNEE, remarks: 5 }],
      [
        'a remark over the limit',
        {
          assignedToId: ASSIGNEE,
          remarks: 'x'.repeat(LEAD_UNASSIGN_REMARK_MAX_LENGTH + 1),
        },
      ],
    ])('400 for %s', async (_label, body) => {
      expect((await unassign(body)).status).toBe(400);
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });
});
