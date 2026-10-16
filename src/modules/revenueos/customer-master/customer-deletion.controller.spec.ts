/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { DataDeletionService } from '../data-governance/data-deletion.service';
import { CUSTOMER_DELETION_POLICY } from './customer-deletion.policy';
import { CustomerDeletionController } from './customer-deletion.controller';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const ID = '00000000-0000-4000-8000-0000000000a1';

describe('customer deletion routes', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] };
  const service = {
    preview: jest.fn(async () => ({ eligible: true })),
    delete: jest.fn(async () => ({ id: 'ts' })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CustomerDeletionController],
      providers: [{ provide: DataDeletionService, useValue: service }],
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
    user = { id: 'user-1', permissions: ['customers.delete'] };
    jest.clearAllMocks();
  });

  const body = (over: Record<string, unknown> = {}) => ({
    reasonCode: 'DUPLICATE',
    reason: 'Same business',
    version: 'v1',
    ...over,
  });

  it('needs customers.delete to preview and to delete (403 otherwise, service never reached)', async () => {
    user = {
      id: 'user-1',
      permissions: [
        'customers.view',
        'customers.edit',
        'customers.deactivate',
        'leads.delete',
        'governance.deletions.view',
      ],
    };
    expect(
      (
        await request(app.getHttpServer()).get(
          `/customers/${ID}/deletion-preview`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/customers/${ID}`)
          .send(body())
      ).status,
    ).toBe(403);
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.delete).not.toHaveBeenCalled();
  });

  it('hands the customer policy, the id, the body and the SIGNED-IN user to the service', async () => {
    const survivor = '00000000-0000-4000-8000-0000000000b2';
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/customers/${ID}`)
          .send(body({ duplicateOfId: survivor }))
      ).status,
    ).toBe(200);
    expect(service.delete).toHaveBeenCalledWith(
      CUSTOMER_DELETION_POLICY,
      ID,
      {
        reasonCode: 'DUPLICATE',
        reason: 'Same business',
        duplicateOfId: survivor,
        version: 'v1',
      },
      'user-1',
    );
    await request(app.getHttpServer()).get(`/customers/${ID}/deletion-preview`);
    expect(service.preview).toHaveBeenCalledWith(CUSTOMER_DELETION_POLICY, ID);
  });

  it.each([
    ['an unknown reason code', { reasonCode: 'X' }],
    ['no reason', { reason: undefined }],
    ['a 501-character reason', { reason: 'x'.repeat(501) }],
    ['an actor from the client', { actorId: 'x' }],
    ['a bad survivor id', { duplicateOfId: 'nope' }],
    ['no version', { version: undefined }],
  ])('refuses %s (400)', async (_n, over) => {
    expect(
      (
        await request(app.getHttpServer())
          .delete(`/customers/${ID}`)
          .send(body(over))
      ).status,
    ).toBe(400);
    expect(service.delete).not.toHaveBeenCalled();
  });
});
