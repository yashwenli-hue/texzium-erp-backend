/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { ProformaInvoicesController } from './proforma-invoices.controller';
import { ProformaInvoicesService } from './proforma-invoices.service';
import {
  PROFORMA_STATUS,
  PROFORMA_TRANSITIONS,
  assertProformaTransition,
  isProformaExpired,
  isProformaTransitionAllowed,
  totalsMatch,
} from './proforma-lifecycle';

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const QUOTE = uid(1);
const PF = uid(21);
const USER = 'user-1';
const ALL_PERMISSIONS = [
  'proformas.view',
  'proformas.create',
  'proformas.approve',
  'proformas.cancel',
];

// ---------------------------------------------------------------------------
// The pure rules
// ---------------------------------------------------------------------------

describe('Proforma lifecycle rules', () => {
  const S = PROFORMA_STATUS;
  const ALL = [S.PENDING, S.APPROVED, S.CANCELLED];

  it('has exactly PENDING, APPROVED and CANCELLED', () => {
    expect(Object.values(S).sort()).toEqual([
      'APPROVED',
      'CANCELLED',
      'PENDING',
    ]);
  });

  it('allows exactly the approved transitions', () => {
    const allowed: Array<[string, string]> = [
      [S.PENDING, S.APPROVED],
      [S.PENDING, S.CANCELLED],
      [S.APPROVED, S.CANCELLED],
    ];
    for (const from of ALL) {
      for (const to of ALL) {
        expect([from, to, isProformaTransitionAllowed(from, to)]).toEqual([
          from,
          to,
          allowed.some(([f, t]) => f === from && t === to),
        ]);
      }
    }
    expect(PROFORMA_TRANSITIONS[S.CANCELLED]).toBeUndefined();
    expect(() => assertProformaTransition(S.CANCELLED, S.APPROVED)).toThrow();
    expect(() => assertProformaTransition(S.APPROVED, S.APPROVED)).toThrow();
  });
});

describe('Proforma validity', () => {
  const at = (iso: string) => new Date(iso);

  it('is valid through the end of the validity date (UTC) and expired from the next day', () => {
    const validity = at('2026-10-05T00:00:00.000Z');
    expect(isProformaExpired(validity, at('2026-10-04T12:00:00.000Z'))).toBe(
      false,
    );
    expect(isProformaExpired(validity, at('2026-10-05T00:00:00.000Z'))).toBe(
      false,
    );
    expect(isProformaExpired(validity, at('2026-10-05T23:59:59.999Z'))).toBe(
      false,
    );
    expect(isProformaExpired(validity, at('2026-10-06T00:00:00.000Z'))).toBe(
      true,
    );
    expect(isProformaExpired(validity, at('2027-01-01T00:00:00.000Z'))).toBe(
      true,
    );
  });

  it('uses the calendar day even when the validity date carries a time of day', () => {
    const validity = at('2026-10-05T17:45:00.000Z');
    expect(isProformaExpired(validity, at('2026-10-05T23:59:59.999Z'))).toBe(
      false,
    );
    expect(isProformaExpired(validity, at('2026-10-06T00:00:00.000Z'))).toBe(
      true,
    );
  });

  it('never expires without a validity date', () => {
    expect(isProformaExpired(null, at('2999-01-01T00:00:00.000Z'))).toBe(false);
    expect(isProformaExpired(undefined, at('2999-01-01T00:00:00.000Z'))).toBe(
      false,
    );
  });

  it('compares totals within a paisa', () => {
    expect(totalsMatch(275000, 275000)).toBe(true);
    expect(totalsMatch(275000.01, 275000)).toBe(true);
    expect(totalsMatch(275000, 275000.01)).toBe(true);
    expect(totalsMatch(275000.02, 275000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The HTTP surface over an in-memory database
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeDb() {
  const state: {
    quotations: Row[];
    proformas: Row[];
    orders: Row[];
    events: Row[];
    customers: Row[];
    users: Row[];
    eventFailure: boolean;
  } = {
    quotations: [],
    proformas: [],
    orders: [],
    events: [],
    customers: [],
    users: [{ id: USER, fullName: 'Asha Approver' }],
    eventFailure: false,
  };

  const matchNot = (cond: any, value: string) =>
    cond === undefined ||
    (typeof cond === 'string' ? cond === value : cond.not !== value);

  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray, id: string) => {
      const sql = strings.join('?');
      if (sql.includes('customer:lock-shared')) {
        const c = state.customers.find((x) => x.id === id);
        return c ? [{ isActive: c.isActive }] : [];
      }
      if (sql.includes('"ProformaInvoice"')) {
        const p = state.proformas.find((x) => x.id === id);
        return p ? [{ customerStatus: p.customerStatus }] : [];
      }
      if (sql.includes('"Quotation"')) {
        const q = state.quotations.find((x) => x.id === id);
        return q ? [{ status: q.status }] : [];
      }
      throw new Error(`unexpected raw query: ${sql}`);
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = JSON.stringify({ p: state.proformas, e: state.events });
      try {
        return await fn(db);
      } catch (e) {
        const s = JSON.parse(snapshot);
        // dates survive as strings in the snapshot, which is fine for these tests
        state.proformas = s.p.map((r: Row) => ({
          ...r,
          validityDate: r.validityDate ? new Date(r.validityDate) : null,
        }));
        state.events = s.e;
        throw e;
      }
    },
    user: {
      findUnique: async ({ where, select }: any) => {
        const u = state.users.find((x) => x.id === where.id);
        if (!u) return null;
        return select ? { id: u.id } : { ...u };
      },
    },
    quotation: {
      findUniqueOrThrow: async ({ where }: any) => {
        const q = state.quotations.find((x) => x.id === where.id);
        if (!q) throw new Error('quotation not found');
        return { ...q };
      },
    },
    proformaInvoice: {
      findUnique: async ({ where }: any) => {
        const p = state.proformas.find((x) => x.id === where.id);
        return p ? { ...p } : null;
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const p = state.proformas.find((x) => x.id === where.id);
        if (!p) throw new Error('proforma not found');
        return { ...p };
      },
      findMany: async () =>
        state.proformas.map((p) => ({
          ...p,
          quotation: state.quotations.find((q) => q.id === p.quotationId),
        })),
      count: async ({ where }: any) =>
        state.proformas.filter(
          (p) =>
            p.quotationId === where.quotationId &&
            matchNot(where.customerStatus, p.customerStatus),
        ).length,
      create: async ({ data }: any) => {
        const row = {
          id: uid(500 + state.proformas.length),
          proformaNumber: null,
          validityDate: null,
          remarks: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.proformas.push(row);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = state.proformas.filter(
          (p) => p.id === where.id && p.customerStatus === where.customerStatus,
        );
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    salesOrder: {
      count: async ({ where }: any) =>
        state.orders.filter(
          (o) =>
            o.proformaInvoiceId === where.proformaInvoiceId &&
            matchNot(where.status, o.status),
        ).length,
    },
    proformaEvent: {
      create: async ({ data }: any) => {
        if (state.eventFailure) throw new Error('event insert failed');
        const row = { id: uid(900 + state.events.length), ...data };
        state.events.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        state.events
          .filter((e) => e.proformaInvoiceId === where.proformaInvoiceId)
          .reverse()
          .map((e) => ({
            ...e,
            actor: state.users.find((u) => u.id === e.actorId) ?? null,
          })),
    },
  };

  return { db, state };
}

const quote = (over: Row = {}): Row => ({
  id: QUOTE,
  status: 'APPROVED',
  totalAmount: 295000,
  ...over,
});
const proforma = (over: Row = {}): Row => ({
  id: PF,
  quotationId: QUOTE,
  customerStatus: 'PENDING',
  totalAmount: 295000,
  validityDate: null,
  issueDate: new Date('2026-10-01'),
  ...over,
});
const startOfTodayUtc = () => {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
  );
};
const daysFromToday = (d: number) =>
  new Date(startOfTodayUtc().getTime() + d * 86_400_000);

describe('Proforma lifecycle over HTTP', () => {
  let app: INestApplication;
  let ctx: ReturnType<typeof makeDb>;
  let permissions: string[];
  let userId: string | undefined;

  const build = async (withRealPermissionsGuard: boolean) => {
    const mod = await Test.createTestingModule({
      controllers: [ProformaInvoicesController],
      providers: [
        ProformaInvoicesService,
        ...(withRealPermissionsGuard ? [PermissionsGuard] : []),
        { provide: PrismaService, useValue: ctx.db },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (c: any) => {
          c.switchToHttp().getRequest().user = { id: userId, permissions };
          return true;
        },
      })
      .compile();

    const instance = mod.createNestApplication();
    instance.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await instance.init();
    return instance;
  };

  beforeEach(async () => {
    ctx = makeDb();
    permissions = ALL_PERMISSIONS;
    userId = USER;
    app = await build(false);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const createBody = (over: Row = {}) => ({
    quotationId: QUOTE,
    issueDate: '2026-10-07T00:00:00.000Z',
    ...over,
  });

  describe('permissions', () => {
    it('declares one permission on every route', () => {
      const proto = ProformaInvoicesController.prototype as any;
      const meta = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);
      expect(meta('create')).toEqual(['proformas.create']);
      expect(meta('findAll')).toEqual(['proformas.view']);
      expect(meta('findEvents')).toEqual(['proformas.view']);
      expect(meta('approve')).toEqual(['proformas.approve']);
      expect(meta('cancel')).toEqual(['proformas.cancel']);
    });

    it('is enforced per action by the real PermissionsGuard', async () => {
      const guarded = await build(true);
      ctx.state.quotations.push(quote());
      ctx.state.proformas.push(proforma());
      const h = () => request(guarded.getHttpServer());

      permissions = ['proformas.view'];
      await h().get('/proforma-invoices').expect(200);
      await h().get(`/proforma-invoices/${PF}/events`).expect(200);
      await h().post('/proforma-invoices').send(createBody()).expect(403);
      await h().patch(`/proforma-invoices/${PF}/approve`).send({}).expect(403);
      await h()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'x' })
        .expect(403);

      permissions = ['proformas.approve'];
      await h().get('/proforma-invoices').expect(403);
      await h()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'x' })
        .expect(403);
      await h().patch(`/proforma-invoices/${PF}/approve`).send({}).expect(200);
      expect(ctx.state.proformas[0].customerStatus).toBe('APPROVED');
      await guarded.close();
    });
  });

  describe('create', () => {
    it("is refused once the Quotation's customer is inactive, and is unaffected when it has none", async () => {
      const CUSTOMER = uid(88);
      ctx.state.customers.push({ id: CUSTOMER, isActive: false });
      ctx.state.quotations.push(
        quote({ opportunity: { customerId: CUSTOMER } }),
      );

      const res = await http()
        .post('/proforma-invoices')
        .send(createBody())
        .expect(409);
      expect(res.body.code).toBe('CUSTOMER_INACTIVE');
      expect(ctx.state.proformas).toHaveLength(0);
      expect(ctx.state.events).toHaveLength(0);

      // active again: created
      ctx.state.customers[0].isActive = true;
      await http().post('/proforma-invoices').send(createBody()).expect(201);

      // a legacy Quotation (its opportunity has no customer) is not checked
      ctx.state.proformas.length = 0;
      ctx.state.quotations[0].opportunity = { customerId: null };
      ctx.state.customers[0].isActive = false;
      await http().post('/proforma-invoices').send(createBody()).expect(201);
    });

    it('creates a PENDING Proforma with the Quotation total, and records who and when', async () => {
      ctx.state.quotations.push(quote());

      const res = await http()
        .post('/proforma-invoices')
        .send(
          createBody({
            validityDate: '2026-12-31T00:00:00.000Z',
            remarks: '  advance 50%  ',
          }),
        )
        .expect(201);

      expect(res.body).toMatchObject({
        quotationId: QUOTE,
        customerStatus: 'PENDING',
        totalAmount: 295000,
        remarks: 'advance 50%',
      });
      expect(ctx.state.events).toHaveLength(1);
      expect(ctx.state.events[0]).toMatchObject({
        proformaInvoiceId: res.body.id,
        action: 'PROFORMA_CREATED',
        toStatus: 'PENDING',
        actorId: USER,
      });
      expect(ctx.state.events[0].fromStatus).toBeUndefined();
    });

    it('accepts a supplied total that matches and never stores a different one', async () => {
      ctx.state.quotations.push(quote());
      const ok = await http()
        .post('/proforma-invoices')
        .send(createBody({ totalAmount: 295000.01 }))
        .expect(201);
      expect(ok.body.totalAmount).toBe(295000);
    });

    it('refuses a supplied total that differs (400) and stores nothing', async () => {
      ctx.state.quotations.push(quote());
      const res = await http()
        .post('/proforma-invoices')
        .send(createBody({ totalAmount: 1000 }))
        .expect(400);
      expect(res.body.message).toMatch(
        /must match the approved Quotation \(295000\)/,
      );
      expect(ctx.state.proformas).toHaveLength(0);
      expect(ctx.state.events).toHaveLength(0);
    });

    it.each(['DRAFT', 'REVISED', 'REJECTED'])(
      'refuses a %s Quotation (409)',
      async (status) => {
        ctx.state.quotations.push(quote({ status }));
        const res = await http()
          .post('/proforma-invoices')
          .send(createBody())
          .expect(409);
        expect(res.body.message).toMatch(
          new RegExp(`APPROVED Quotation \\(now ${status}\\)`),
        );
        expect(ctx.state.proformas).toHaveLength(0);
      },
    );

    it('404s an unknown Quotation', async () => {
      await http()
        .post('/proforma-invoices')
        .send(createBody({ quotationId: uid(77) }))
        .expect(404);
    });

    it.each(['PENDING', 'APPROVED'])(
      'allows only one active Proforma per Quotation (a %s one exists)',
      async (customerStatus) => {
        ctx.state.quotations.push(quote());
        ctx.state.proformas.push(proforma({ customerStatus }));
        const res = await http()
          .post('/proforma-invoices')
          .send(createBody())
          .expect(409);
        expect(res.body.message).toMatch(
          /already has an active Proforma Invoice/,
        );
        expect(ctx.state.proformas).toHaveLength(1);
      },
    );

    it('allows a new Proforma once the earlier one is cancelled', async () => {
      ctx.state.quotations.push(quote());
      ctx.state.proformas.push(proforma({ customerStatus: 'CANCELLED' }));
      await http().post('/proforma-invoices').send(createBody()).expect(201);
      expect(ctx.state.proformas).toHaveLength(2);
    });

    it.each([
      ['a quotation id that is not a UUID', { quotationId: 'q-1' }],
      ['a missing quotation id', { quotationId: undefined }],
      ['an issue date that is not a date', { issueDate: 'yesterday' }],
      ['an impossible issue date', { issueDate: '2026-02-31' }],
      ['a validity date that is not a date', { validityDate: 'soon' }],
      ['a zero total', { totalAmount: 0 }],
      ['a negative total', { totalAmount: -5 }],
      ['a string total', { totalAmount: '295000' }],
      ['an undeclared status', { customerStatus: 'APPROVED' }],
      ['an undeclared actor', { actorId: 'someone' }],
      ['overlong remarks', { remarks: 'x'.repeat(501) }],
    ])('rejects %s (400)', async (_n, over) => {
      ctx.state.quotations.push(quote());
      await http()
        .post('/proforma-invoices')
        .send(createBody(over))
        .expect(400);
      expect(ctx.state.proformas).toHaveLength(0);
    });

    it('accepts the date shapes the existing screens send', async () => {
      ctx.state.quotations.push(quote());
      await http()
        .post('/proforma-invoices')
        .send({
          quotationId: QUOTE,
          issueDate: '2026-10-07',
          validityDate: '2026-10-31',
        })
        .expect(201);
    });
  });

  describe('approve', () => {
    it('approves a PENDING Proforma and records who and when', async () => {
      ctx.state.proformas.push(proforma());
      const res = await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({ remarks: ' customer confirmed ' })
        .expect(200);
      expect(res.body.customerStatus).toBe('APPROVED');
      expect(ctx.state.events[0]).toMatchObject({
        action: 'PROFORMA_APPROVED',
        fromStatus: 'PENDING',
        toStatus: 'APPROVED',
        remarks: 'customer confirmed',
        actorId: USER,
      });
    });

    it('works without a body', async () => {
      ctx.state.proformas.push(proforma());
      await http().patch(`/proforma-invoices/${PF}/approve`).expect(200);
    });

    it('is not repeatable and a cancelled Proforma cannot be approved', async () => {
      ctx.state.proformas.push(proforma({ customerStatus: 'APPROVED' }));
      const again = await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(409);
      expect(again.body.message).toMatch(/already approved/);

      ctx.state.proformas[0].customerStatus = 'CANCELLED';
      const cancelled = await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(409);
      expect(cancelled.body.message).toMatch(/cancelled/);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('refuses an expired Proforma (409) and leaves it untouched', async () => {
      ctx.state.proformas.push(proforma({ validityDate: daysFromToday(-1) }));
      const res = await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(409);
      expect(res.body.message).toMatch(
        /expired on \d{4}-\d{2}-\d{2} and can no longer be approved/,
      );
      expect(ctx.state.proformas[0].customerStatus).toBe('PENDING');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('approves through the end of the validity date', async () => {
      ctx.state.proformas.push(proforma({ validityDate: daysFromToday(0) }));
      await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(200);
    });

    it('404s an unknown Proforma and rejects an undeclared body', async () => {
      await http()
        .patch(`/proforma-invoices/${uid(77)}/approve`)
        .send({})
        .expect(404);
      ctx.state.proformas.push(proforma());
      await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({ customerStatus: 'APPROVED' })
        .expect(400);
      await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({ actorId: 'x' })
        .expect(400);
    });
  });

  describe('cancel', () => {
    it.each(['PENDING', 'APPROVED'])(
      'cancels a %s Proforma with a mandatory reason',
      async (customerStatus) => {
        ctx.state.proformas.push(proforma({ customerStatus }));
        const res = await http()
          .patch(`/proforma-invoices/${PF}/cancel`)
          .send({ reason: '  wrong customer  ' })
          .expect(200);
        expect(res.body.customerStatus).toBe('CANCELLED');
        expect(ctx.state.events[0]).toMatchObject({
          action: 'PROFORMA_CANCELLED',
          fromStatus: customerStatus,
          toStatus: 'CANCELLED',
          remarks: 'wrong customer',
          actorId: USER,
        });
      },
    );

    it('needs a non-blank reason', async () => {
      ctx.state.proformas.push(proforma());
      for (const body of [
        {},
        { reason: '' },
        { reason: '   ' },
        { reason: 7 },
        { reason: 'x'.repeat(501) },
      ]) {
        await http()
          .patch(`/proforma-invoices/${PF}/cancel`)
          .send(body)
          .expect(400);
      }
      expect(ctx.state.proformas[0].customerStatus).toBe('PENDING');
    });

    it('is terminal', async () => {
      ctx.state.proformas.push(proforma({ customerStatus: 'CANCELLED' }));
      const res = await http()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'x' })
        .expect(409);
      expect(res.body.message).toMatch(/already cancelled/);
      await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(409);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('is refused while a Sales Order that is not cancelled references it', async () => {
      ctx.state.proformas.push(proforma({ customerStatus: 'APPROVED' }));
      for (const status of [
        'OPEN',
        'PENDING_STORE_APPROVAL',
        'READY_FOR_DISPATCH_ORDER',
        'DISPATCH_ORDER_CREATED',
      ]) {
        ctx.state.orders.length = 0;
        ctx.state.orders.push({ id: uid(31), proformaInvoiceId: PF, status });
        const res = await http()
          .patch(`/proforma-invoices/${PF}/cancel`)
          .send({ reason: 'x' })
          .expect(409);
        expect(res.body.message).toMatch(/Cancel the Sales Order first/);
      }
      expect(ctx.state.proformas[0].customerStatus).toBe('APPROVED');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('is allowed when its only Sales Order is cancelled, or when the order belongs to another Proforma', async () => {
      ctx.state.proformas.push(proforma({ customerStatus: 'APPROVED' }));
      ctx.state.orders.push({
        id: uid(31),
        proformaInvoiceId: PF,
        status: 'CANCELLED',
      });
      ctx.state.orders.push({
        id: uid(32),
        proformaInvoiceId: uid(99),
        status: 'OPEN',
      });
      await http()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'x' })
        .expect(200);
    });

    it('can cancel a legacy expired APPROVED Proforma that has no order (existing rows are not special-cased)', async () => {
      ctx.state.proformas.push(
        proforma({
          customerStatus: 'APPROVED',
          validityDate: daysFromToday(-30),
        }),
      );
      await http()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'expired' })
        .expect(200);
    });
  });

  describe('actor, atomicity and history', () => {
    it('needs a signed-in user that exists', async () => {
      ctx.state.proformas.push(proforma());
      userId = undefined;
      await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(401);
      userId = 'ghost';
      await http()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'x' })
        .expect(401);
      expect(ctx.state.proformas[0].customerStatus).toBe('PENDING');
    });

    it('rolls the change back when its event cannot be written', async () => {
      ctx.state.quotations.push(quote());
      ctx.state.proformas.push(proforma());
      ctx.state.eventFailure = true;

      await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(500);
      await http()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'x' })
        .expect(500);
      expect(ctx.state.proformas[0].customerStatus).toBe('PENDING');

      await http()
        .post('/proforma-invoices')
        .send(createBody({ quotationId: QUOTE }))
        .expect(409); // active one exists
      ctx.state.proformas[0].customerStatus = 'CANCELLED';
      await http().post('/proforma-invoices').send(createBody()).expect(500);
      expect(ctx.state.proformas).toHaveLength(1);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('moves only if the Proforma is still where the lock read it (compare-and-set)', async () => {
      ctx.state.proformas.push(proforma());
      const realQuery = ctx.db.$queryRaw;
      ctx.db.$queryRaw = async (...a: any[]) => {
        const rows = await realQuery(...a);
        ctx.state.proformas[0].customerStatus = 'CANCELLED';
        return rows.map(() => ({ customerStatus: 'PENDING' }));
      };
      const res = await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(409);
      expect(res.body.message).toMatch(/cancelled/);
      expect(ctx.state.proformas[0].customerStatus).not.toBe('APPROVED');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('lists events newest first with only the actor id and name, and 404s an unknown Proforma', async () => {
      ctx.state.proformas.push(proforma());
      await http()
        .patch(`/proforma-invoices/${PF}/approve`)
        .send({})
        .expect(200);
      await http()
        .patch(`/proforma-invoices/${PF}/cancel`)
        .send({ reason: 'x' })
        .expect(200);

      const res = await http()
        .get(`/proforma-invoices/${PF}/events`)
        .expect(200);
      expect(res.body.map((e: Row) => e.action)).toEqual([
        'PROFORMA_CANCELLED',
        'PROFORMA_APPROVED',
      ]);
      expect(res.body[0].actor).toEqual({
        id: USER,
        fullName: 'Asha Approver',
      });
      await http()
        .get(`/proforma-invoices/${uid(77)}/events`)
        .expect(404);
    });
  });

  describe('listing', () => {
    it('returns every Proforma with its Quotation and a derived isExpired', async () => {
      ctx.state.quotations.push(quote());
      ctx.state.proformas.push(
        proforma({ id: uid(21), validityDate: daysFromToday(-1) }),
        proforma({ id: uid(22), validityDate: daysFromToday(0) }),
        proforma({ id: uid(23), validityDate: null }),
      );
      const res = await http().get('/proforma-invoices').expect(200);
      expect(res.body.map((p: Row) => [p.id, p.isExpired])).toEqual([
        [uid(21), true],
        [uid(22), false],
        [uid(23), false],
      ]);
      expect(res.body[0].quotation.id).toBe(QUOTE);
    });
  });
});
