/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { DataDeletionsController } from '../data-governance/data-deletion.controller';
import { DataDeletionService } from '../data-governance/data-deletion.service';
import { LeadDeletionController } from './lead-deletion.controller';
import { LEAD_DELETION_POLICY } from './lead-deletion.policy';

// The routes, their permissions and what the request may carry, with the service
// replaced by a double (its rules are in data-deletion.service.spec.ts).

const LEAD = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

describe('lead deletion routes', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] };

  const service = {
    preview: jest.fn(async () => ({ eligible: true })),
    delete: jest.fn(async () => ({ id: 'ts-1' })),
    list: jest.fn(async () => []),
    findOne: jest.fn(async () => ({ id: 'ts-1' })),
    restorePreview: jest.fn(async () => ({ eligible: true })),
    restore: jest.fn(async () => ({ id: 'ts-1' })),
    purge: jest.fn(async () => ({ id: 'ts-1' })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LeadDeletionController, DataDeletionsController],
      providers: [{ provide: DataDeletionService, useValue: service }],
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
    user = {
      id: 'user-1',
      permissions: [
        'leads.delete',
        'governance.deletions.view',
        'governance.deletions.restore',
        'governance.deletions.purge',
      ],
    };
    jest.clearAllMocks();
  });

  const body = (over: Record<string, unknown> = {}) => ({
    reasonCode: 'TEST_DATA',
    reason: 'Created while testing',
    version: 'abc123',
    ...over,
  });
  const del = (payload: unknown, id = LEAD) =>
    request(app.getHttpServer())
      .delete(`/leads/${id}`)
      .send(payload as object);

  describe('permissions', () => {
    it.each([
      [
        'preview without leads.delete',
        () =>
          request(app.getHttpServer()).get(`/leads/${LEAD}/deletion-preview`),
        ['leads.view', 'leads.edit', 'leads.deactivate'],
      ],
      [
        'delete without leads.delete',
        () => del(body()),
        ['leads.view', 'leads.edit', 'leads.deactivate', 'customers.delete'],
      ],
      [
        'the log without governance.deletions.view',
        () => request(app.getHttpServer()).get('/data-deletions'),
        ['leads.delete'],
      ],
      [
        'one log record without governance.deletions.view',
        () => request(app.getHttpServer()).get('/data-deletions/ts-1'),
        ['leads.delete'],
      ],
    ])(
      'refuses %s (403) and never reaches the service',
      async (_name, call, permissions) => {
        user = { id: 'user-1', permissions };
        const res = await call();

        expect(res.status).toBe(403);
        expect(service.preview).not.toHaveBeenCalled();
        expect(service.delete).not.toHaveBeenCalled();
        expect(service.list).not.toHaveBeenCalled();
        expect(service.findOne).not.toHaveBeenCalled();
      },
    );

    it('refuses a user with no permissions at all (403)', async () => {
      user = { id: 'user-1', permissions: [] };
      expect((await del(body())).status).toBe(403);
    });

    it('allows leads.delete to preview and delete', async () => {
      expect(
        (
          await request(app.getHttpServer()).get(
            `/leads/${LEAD}/deletion-preview`,
          )
        ).status,
      ).toBe(200);
      expect((await del(body())).status).toBe(200);
    });

    it('does not let leads.deactivate (or any other lead permission) delete', async () => {
      user = {
        id: 'user-1',
        permissions: [
          'leads.deactivate',
          'leads.edit',
          'leads.view',
          'leads.create',
        ],
      };
      expect((await del(body())).status).toBe(403);
    });
  });

  describe('the request', () => {
    it('hands the lead policy, the id, the body and the SIGNED-IN user to the service', async () => {
      const res = await del(
        body({
          reasonCode: 'DUPLICATE',
          reason: '  Same buyer  ',
          duplicateOfId: OTHER,
        }),
      );

      expect(res.status).toBe(200);
      expect(service.delete).toHaveBeenCalledWith(
        LEAD_DELETION_POLICY,
        LEAD,
        {
          reasonCode: 'DUPLICATE',
          reason: 'Same buyer',
          duplicateOfId: OTHER,
          version: 'abc123',
        },
        'user-1',
      );
    });

    it('previews with the lead policy', async () => {
      await request(app.getHttpServer()).get(`/leads/${LEAD}/deletion-preview`);
      expect(service.preview).toHaveBeenCalledWith(LEAD_DELETION_POLICY, LEAD);
    });

    it.each([
      ['no reason code', { reasonCode: undefined }],
      ['an unknown reason code', { reasonCode: 'BECAUSE' }],
      ['no reason', { reason: undefined }],
      ['a blank reason', { reason: '    ' }],
      ['a 501-character reason', { reason: 'x'.repeat(501) }],
      ['no version', { version: undefined }],
      ['a duplicateOfId that is not a UUID', { duplicateOfId: 'not-a-uuid' }],
      ['an actor supplied by the client', { actorId: 'someone-else' }],
      ['a deletedById supplied by the client', { deletedById: 'someone-else' }],
      ['a property the request does not declare', { force: true }],
    ])(
      'refuses %s (400) and never reaches the service',
      async (_name, over) => {
        const res = await del(body(over));

        expect(res.status).toBe(400);
        expect(service.delete).not.toHaveBeenCalled();
      },
    );

    it('accepts a 500-character reason and exactly the five reason codes', async () => {
      expect((await del(body({ reason: 'x'.repeat(500) }))).status).toBe(200);

      for (const reasonCode of [
        'DUPLICATE',
        'ENTERED_IN_ERROR',
        'TEST_DATA',
        'JUNK_OR_SPAM',
        'OTHER',
      ]) {
        expect((await del(body({ reasonCode }))).status).toBe(200);
      }
    });
  });

  describe('the deletion log, restore and purge', () => {
    const http = () => request(app.getHttpServer());

    it.each([
      [
        'restore preview',
        () => http().get('/data-deletions/ts-1/restore-preview'),
        [
          'governance.deletions.view',
          'leads.delete',
          'governance.deletions.purge',
        ],
      ],
      [
        'restore',
        () =>
          http().post('/data-deletions/ts-1/restore').send({ version: 'v' }),
        [
          'governance.deletions.view',
          'leads.delete',
          'governance.deletions.purge',
        ],
      ],
      [
        'purge',
        () => http().post('/data-deletions/ts-1/purge').send({}),
        [
          'governance.deletions.view',
          'governance.deletions.restore',
          'leads.delete',
        ],
      ],
    ])(
      '%s is refused (403) without its own permission',
      async (_name, call, permissions) => {
        user = { id: 'user-1', permissions };
        expect((await call()).status).toBe(403);
        expect(service.restorePreview).not.toHaveBeenCalled();
        expect(service.restore).not.toHaveBeenCalled();
        expect(service.purge).not.toHaveBeenCalled();
      },
    );

    it('restore hands the id, the token and the SIGNED-IN user to the service', async () => {
      const res = await http()
        .post('/data-deletions/ts-1/restore')
        .send({ version: 'abc' });
      expect(res.status).toBe(201);
      expect(service.restore).toHaveBeenCalledWith(
        'ts-1',
        { version: 'abc' },
        'user-1',
      );
    });

    it.each([
      ['no version', {}],
      ['an empty version', { version: '' }],
      ['an actor from the client', { version: 'v', restoredById: 'x' }],
      ['an undeclared field', { version: 'v', force: true }],
    ])('restore refuses %s (400)', async (_n, payload) => {
      expect(
        (await http().post('/data-deletions/ts-1/restore').send(payload))
          .status,
      ).toBe(400);
      expect(service.restore).not.toHaveBeenCalled();
    });

    it('purge takes no body fields, and uses the signed-in user', async () => {
      expect(
        (await http().post('/data-deletions/ts-1/purge').send({})).status,
      ).toBe(201);
      expect(service.purge).toHaveBeenCalledWith('ts-1', 'user-1');
    });

    it.each([
      ['post', '/data-deletions'],
      ['put', '/data-deletions/ts-1'],
      ['patch', '/data-deletions/ts-1'],
      ['delete', '/data-deletions/ts-1'],
    ])(
      'has no %s route on a tombstone itself (it cannot be created, edited or removed through the API)',
      async (method, path) => {
        const res = await (http() as any)[method](path).send({});
        expect(res.status).toBe(404);
      },
    );

    it('lists with a validated query (type, status, paging)', async () => {
      expect(
        (
          await http().get(
            '/data-deletions?entityType=LEAD&status=DELETED&limit=20&offset=0',
          )
        ).status,
      ).toBe(200);
      expect(service.list).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'LEAD',
          status: 'DELETED',
          limit: 20,
          offset: 0,
        }),
      );
      expect(
        (await http().get('/data-deletions?entityType=ROBOT')).status,
      ).toBe(400);
      expect((await http().get('/data-deletions?status=GONE')).status).toBe(
        400,
      );
      expect((await http().get('/data-deletions?limit=500')).status).toBe(400);
    });
  });
});
