/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return -- test doubles are intentionally loosely typed */
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  ALL_RECORDS,
  VIEW_ALL_PERMISSION,
  and,
  customerWhere,
  leadWhere,
  quotationWhere,
  salesOrderWhere,
  scopeOf,
} from './record-scope';
import {
  RecordScopeGuard,
  ScopedRecord,
  SCOPED_RECORDS_KEY,
} from './record-scope.guard';

describe('record scope', () => {
  it('is unrestricted with revenue.view.all and the caller otherwise', () => {
    expect(scopeOf({ id: 'u1', permissions: [VIEW_ALL_PERMISSION] })).toEqual({
      all: true,
    });
    expect(scopeOf({ id: 'u1', permissions: ['leads.view'] })).toEqual({
      all: false,
      userId: 'u1',
    });
    // a string is not a permission list (it would match by substring)
    expect(scopeOf({ id: 'u1', permissions: VIEW_ALL_PERMISSION })).toEqual({
      all: false,
      userId: 'u1',
    });
    expect(() => scopeOf(undefined)).toThrow(UnauthorizedException);
    expect(() => scopeOf({ permissions: [VIEW_ALL_PERMISSION] })).toThrow(
      UnauthorizedException,
    );
  });

  it('adds nothing for an unrestricted caller', () => {
    expect(leadWhere(ALL_RECORDS)).toBeUndefined();
    expect(customerWhere(ALL_RECORDS)).toBeUndefined();
    expect(salesOrderWhere(ALL_RECORDS)).toBeUndefined();
    expect(and({ isActive: true }, undefined)).toEqual({ isActive: true });
  });

  it('derives a lead from assignment, history and completed follow-ups', () => {
    expect(leadWhere({ all: false, userId: 'u1' })).toEqual({
      OR: [
        { assignedToId: 'u1' },
        {
          timelines: {
            some: { OR: [{ actorId: 'u1' }, { subjectUserId: 'u1' }] },
          },
        },
        { followups: { some: { completedById: 'u1' } } },
      ],
    });
  });

  it('follows the document chain down from the lead', () => {
    const s = { all: false as const, userId: 'u1' };
    expect(quotationWhere(s)).toEqual({ opportunity: { lead: leadWhere(s) } });
    expect(salesOrderWhere(s)).toEqual({
      OR: [
        { proformaInvoice: { quotation: quotationWhere(s) } },
        { Quotation: quotationWhere(s) },
      ],
    });
    expect(customerWhere(s)).toEqual({
      OR: [
        { opportunities: { some: { lead: leadWhere(s) } } },
        { events: { some: { actorId: 'u1' } } },
      ],
    });
    expect(and({ isActive: true }, leadWhere(s))).toEqual({
      AND: [{ isActive: true }, leadWhere(s)],
    });
  });
});

describe('RecordScopeGuard', () => {
  class Ctl {
    @ScopedRecord('lead', 'params.id')
    @ScopedRecord('customer', 'body.customerId')
    both() {}
    plain() {}
  }
  const counts: Record<string, number> = {};
  const db: any = new Proxy(
    {},
    {
      get: (_t, model: string) => ({
        count: jest.fn(async () => counts[model] ?? 0),
      }),
    },
  );
  const guard = new RecordScopeGuard(new Reflector(), db);
  const ctx = (handler: () => void, req: object) =>
    ({
      getHandler: () => handler,
      switchToHttp: () => ({ getRequest: () => req }),
    }) as any;

  beforeEach(() => {
    for (const k of Object.keys(counts)) delete counts[k];
  });

  it('collects stacked decorators', () => {
    expect(Reflect.getMetadata(SCOPED_RECORDS_KEY, Ctl.prototype.both)).toEqual(
      expect.arrayContaining([
        { kind: 'lead', from: 'params', field: 'id' },
        { kind: 'customer', from: 'body', field: 'customerId' },
      ]),
    );
  });

  it('lets an undecorated route and an unrestricted caller through without reading anything', async () => {
    await expect(
      guard.canActivate(
        ctx(Ctl.prototype.plain, { user: { id: 'u1', permissions: [] } }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        ctx(Ctl.prototype.both, {
          user: { id: 'u1', permissions: [VIEW_ALL_PERMISSION] },
          params: { id: 'x' },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('answers 404 for a record outside the scope, and checks every decorated id', async () => {
    const req = {
      user: { id: 'u1', permissions: [] },
      params: { id: 'l1' },
      body: { customerId: 'c1' },
    };
    await expect(
      guard.canActivate(ctx(Ctl.prototype.both, req)),
    ).rejects.toThrow(new NotFoundException('Lead not found.'));
    counts.lead = 1;
    await expect(
      guard.canActivate(ctx(Ctl.prototype.both, req)),
    ).rejects.toThrow(new NotFoundException('Customer not found.'));
    counts.customer = 1;
    await expect(guard.canActivate(ctx(Ctl.prototype.both, req))).resolves.toBe(
      true,
    );
  });

  it('leaves a missing or non-string id to validation', async () => {
    await expect(
      guard.canActivate(
        ctx(Ctl.prototype.both, {
          user: { id: 'u1', permissions: [] },
          params: {},
          body: { customerId: 5 },
        }),
      ),
    ).resolves.toBe(true);
  });
});
