import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { PaymentCollectionsController } from './payment-collections.controller';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

const routes = ['create', 'findAll', 'findByInvoice', 'findOne'] as const;

describe('PaymentCollectionsController access', () => {
  const guards: unknown = Reflect.getMetadata(
    '__guards__',
    PaymentCollectionsController,
  );

  it('requires a signed-in user, checks permissions and the record scope on every route', () => {
    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard, RecordScopeGuard]);
  });

  it('PermissionsGuard lets a route through when it declares nothing, so every route must declare', () => {
    for (const name of routes) {
      const required: unknown = Reflect.getMetadata(
        PERMISSIONS_KEY,
        PaymentCollectionsController.prototype[name],
      );

      expect(Array.isArray(required) && required.length > 0).toBe(true);
    }
  });

  it('recording needs collections.record; every read needs collections.view', () => {
    const need = (name: (typeof routes)[number]): unknown =>
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        PaymentCollectionsController.prototype[name],
      );

    expect(need('create')).toEqual(['collections.record']);
    expect(need('findAll')).toEqual(['collections.view']);
    expect(need('findByInvoice')).toEqual(['collections.view']);
    expect(need('findOne')).toEqual(['collections.view']);
  });

  it('declares no route beyond the four that are guarded', () => {
    const own = Object.getOwnPropertyNames(
      PaymentCollectionsController.prototype,
    ).filter((n) => n !== 'constructor');

    expect(own.sort()).toEqual([...routes].sort());
  });

  it('passes the signed-in user, never a client value, to the command', () => {
    const calls: unknown[][] = [];
    const controller = new PaymentCollectionsController({
      create: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({});
      },
    } as never);

    void controller.create({ salesInvoiceId: 'i' } as never, {
      user: { id: 'user-1' },
    });
    void controller.create({ salesInvoiceId: 'i' } as never, {});

    expect(calls[0][1]).toBe('user-1');
    expect(calls[1][1]).toBeUndefined();
  });
});

describe('the live PaymentCollectionsModule', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.resolve(__dirname, '../../..', rel), 'utf8');

  it('is the RevenueOS one; the duplicate FinanceOS module is not wired into the application', () => {
    const app = read('app.module.ts');

    expect(app).toMatch(
      /modules\/revenueos\/payment-collections\/payment-collections\.module/,
    );
    expect(app).not.toMatch(
      /modules\/financeos\/payment-collections\/payment-collections\.module/,
    );
  });
});
