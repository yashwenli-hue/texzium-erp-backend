/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';
import {
  QUOTATION_STATUS,
  QUOTATION_TRANSITIONS,
  assertQuotationTransition,
  computeQuotationAmounts,
  hasConsistentTaxBreakdown,
  isQuotationTransitionAllowed,
  roundMoney,
} from './quotation-lifecycle';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const QUOTE = uid(1);
const USER = 'user-1';
const ALL_PERMISSIONS = [
  'quotations.view',
  'quotations.create',
  'quotations.edit',
  'quotations.approve',
  'quotations.reject',
];

// ---------------------------------------------------------------------------
// The pure rules
// ---------------------------------------------------------------------------

describe('Quotation lifecycle rules', () => {
  const S = QUOTATION_STATUS;
  const ALL = [S.DRAFT, S.REVISED, S.APPROVED, S.REJECTED];

  it('has exactly the four approved statuses', () => {
    expect(Object.values(S).sort()).toEqual([
      'APPROVED',
      'DRAFT',
      'REJECTED',
      'REVISED',
    ]);
  });

  it('allows exactly the approved transitions', () => {
    const allowed: Array<[string, string]> = [
      [S.DRAFT, S.REVISED],
      [S.DRAFT, S.APPROVED],
      [S.DRAFT, S.REJECTED],
      [S.REVISED, S.REVISED],
      [S.REVISED, S.APPROVED],
      [S.REVISED, S.REJECTED],
      [S.APPROVED, S.REVISED],
    ];

    for (const from of ALL) {
      for (const to of ALL) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect([from, to, isQuotationTransitionAllowed(from, to)]).toEqual([
          from,
          to,
          expected,
        ]);
      }
    }
  });

  it('REJECTED is terminal and APPROVED is otherwise immutable', () => {
    expect(QUOTATION_TRANSITIONS[S.REJECTED]).toBeUndefined();
    expect(QUOTATION_TRANSITIONS[S.APPROVED]).toEqual([S.REVISED]);
  });

  it('knows no EXPIRED or CONVERTED status, and treats an unknown status as a dead end', () => {
    expect(isQuotationTransitionAllowed('EXPIRED', S.APPROVED)).toBe(false);
    expect(isQuotationTransitionAllowed('CONVERTED', S.REVISED)).toBe(false);
    expect(isQuotationTransitionAllowed(S.DRAFT, 'CONVERTED')).toBe(false);
    expect(() => assertQuotationTransition(S.REJECTED, S.APPROVED)).toThrow();
    expect(() => assertQuotationTransition(S.DRAFT, S.APPROVED)).not.toThrow();
  });
});

describe('Quotation amounts', () => {
  it('recomputes GST and the total from the stored percentage', () => {
    expect(computeQuotationAmounts(100000, 18)).toEqual({
      taxableAmount: 100000,
      gstAmount: 18000,
      totalAmount: 118000,
    });
    expect(computeQuotationAmounts(0.5, 18)).toEqual({
      taxableAmount: 0.5,
      gstAmount: 0.09,
      totalAmount: 0.59,
    });
    // 0% GST is a real rate, not a missing value
    expect(computeQuotationAmounts(250, 0)).toEqual({
      taxableAmount: 250,
      gstAmount: 0,
      totalAmount: 250,
    });
  });

  it('rounds to paise', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    const a = computeQuotationAmounts(12345.67, 18);
    expect(a.gstAmount).toBe(2222.22);
    expect(a.totalAmount).toBe(14567.89);
  });

  it('accepts a breakdown that adds up (including the unrounded figures creation stores)', () => {
    expect(
      hasConsistentTaxBreakdown({
        taxableAmount: 250000,
        gstPercent: 18,
        gstAmount: 45000,
        totalAmount: 295000,
      }),
    ).toBe(true);

    const taxable = 12345.67 * 3;
    const gst = (taxable * 18) / 100;
    expect(
      hasConsistentTaxBreakdown({
        taxableAmount: taxable,
        gstPercent: 18,
        gstAmount: gst,
        totalAmount: taxable + gst,
      }),
    ).toBe(true);
  });

  it('refuses the legacy shapes it must not touch', () => {
    // approved before the breakdown was stored: taxable, percent and GST are 0
    expect(
      hasConsistentTaxBreakdown({
        taxableAmount: 0,
        gstPercent: 0,
        gstAmount: 0,
        totalAmount: 250000,
      }),
    ).toBe(false);
    // the old revise changed the total alone
    expect(
      hasConsistentTaxBreakdown({
        taxableAmount: 250000,
        gstPercent: 18,
        gstAmount: 45000,
        totalAmount: 300000,
      }),
    ).toBe(false);
    // GST that is not the stated percentage of the taxable amount
    expect(
      hasConsistentTaxBreakdown({
        taxableAmount: 250000,
        gstPercent: 18,
        gstAmount: 40000,
        totalAmount: 290000,
      }),
    ).toBe(false);
    // nothing to sell
    expect(
      hasConsistentTaxBreakdown({
        taxableAmount: 0,
        gstPercent: 0,
        gstAmount: 0,
        totalAmount: 0,
      }),
    ).toBe(false);
    expect(
      hasConsistentTaxBreakdown({
        taxableAmount: NaN,
        gstPercent: 18,
        gstAmount: NaN,
        totalAmount: NaN,
      }),
    ).toBe(false);
  });

  it('allows a difference of a paisa and no more', () => {
    const base = { taxableAmount: 1000, gstPercent: 18, gstAmount: 180 };
    expect(hasConsistentTaxBreakdown({ ...base, totalAmount: 1180.01 })).toBe(
      true,
    );
    expect(hasConsistentTaxBreakdown({ ...base, totalAmount: 1180.02 })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The HTTP surface over an in-memory database
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeDb() {
  const state: {
    quotations: Row[];
    lines: Row[];
    events: Row[];
    proformas: Row[];
    orders: Row[];
    users: Row[];
    queryFailure: boolean;
    eventFailure: boolean;
  } = {
    quotations: [],
    lines: [],
    events: [],
    proformas: [],
    orders: [],
    users: [{ id: USER, fullName: 'Asha Approver' }],
    queryFailure: false,
    eventFailure: false,
  };

  const pick = (row: Row | undefined, select?: Row) => {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k])
        .map((k) => [k, row[k]]),
    );
  };

  const matchStatus = (cond: any, value: string) =>
    cond === undefined ||
    (typeof cond === 'string' ? cond === value : cond.not !== value);

  const db: any = {
    $queryRaw: async (_strings: TemplateStringsArray, id: string) => {
      if (state.queryFailure) throw new Error('lock failed');
      const q = state.quotations.find((x) => x.id === id);
      return q ? [{ status: q.status }] : [];
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = JSON.stringify({
        q: state.quotations,
        l: state.lines,
        e: state.events,
      });
      try {
        return await fn(db);
      } catch (e) {
        const s = JSON.parse(snapshot);
        state.quotations = s.q;
        state.lines = s.l;
        state.events = s.e;
        throw e;
      }
    },
    user: {
      findUnique: async ({ where, select }: any) =>
        pick(
          state.users.find((u) => u.id === where.id),
          select,
        ),
    },
    quotation: {
      findUnique: async ({ where, select }: any) =>
        pick(
          state.quotations.find((q) => q.id === where.id),
          select,
        ),
      findUniqueOrThrow: async ({ where }: any) => {
        const q = state.quotations.find((x) => x.id === where.id);
        if (!q) throw new Error('not found');
        return { ...q };
      },
      findMany: async () => state.quotations.map((q) => ({ ...q })),
      updateMany: async ({ where, data }: any) => {
        const rows = state.quotations.filter(
          (q) => q.id === where.id && q.status === where.status,
        );
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    quotationLine: {
      findMany: async ({ where }: any) =>
        state.lines
          .filter((l) => l.quotationId === where.quotationId)
          .sort((a, b) => a.lineNumber - b.lineNumber)
          .map((l) => ({ ...l })),
      update: async ({ where, data }: any) => {
        const row = state.lines.find((l) => l.id === where.id) as Row;
        Object.assign(row, data);
        return { ...row };
      },
    },
    quotationEvent: {
      create: async ({ data }: any) => {
        if (state.eventFailure) throw new Error('event insert failed');
        const row = { id: uid(900 + state.events.length), ...data };
        state.events.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        state.events
          .filter((e) => e.quotationId === where.quotationId)
          .reverse()
          .map((e) => ({
            ...e,
            actor: state.users.find((u) => u.id === e.actorId) ?? null,
          })),
    },
    proformaInvoice: {
      count: async ({ where }: any) =>
        state.proformas.filter(
          (p) =>
            p.quotationId === where.quotationId &&
            matchStatus(where.customerStatus, p.customerStatus),
        ).length,
    },
    salesOrder: {
      count: async ({ where }: any) =>
        state.orders.filter((o) => {
          if (!matchStatus(where.status, o.status)) return false;
          return where.OR.some((c: any) =>
            c.quotationId !== undefined
              ? o.quotationId === c.quotationId
              : state.proformas.some(
                  (p) =>
                    p.id === o.proformaInvoiceId &&
                    p.quotationId === c.proformaInvoice.quotationId,
                ),
          );
        }).length,
    },
  };

  return { db, state };
}

const quote = (over: Row = {}): Row => ({
  id: QUOTE,
  status: 'DRAFT',
  opportunityId: uid(2),
  taxableAmount: 250000,
  gstPercent: 18,
  gstAmount: 45000,
  totalAmount: 295000,
  ...over,
});

describe('Quotation lifecycle over HTTP', () => {
  let app: INestApplication;
  let ctx: ReturnType<typeof makeDb>;
  let permissions: string[];
  let userId: string | undefined;

  beforeEach(async () => {
    ctx = makeDb();
    permissions = ALL_PERMISSIONS;
    userId = USER;

    const mod = await Test.createTestingModule({
      controllers: [QuotationsController],
      providers: [
        QuotationsService,
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
      .overrideGuard(RecordScopeGuard)
      .useValue(SCOPE_TESTED_ELSEWHERE)
      .compile();

    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe('permissions', () => {
    it('declares one permission on every route except the legacy convert (retired in the next checkpoint)', () => {
      const proto = QuotationsController.prototype as any;
      const meta = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);

      expect(meta('create')).toEqual(['quotations.create']);
      expect(meta('findAll')).toEqual(['quotations.view']);
      expect(meta('findEvents')).toEqual(['quotations.view']);
      expect(meta('revise')).toEqual(['quotations.edit']);
      expect(meta('approve')).toEqual(['quotations.approve']);
      expect(meta('reject')).toEqual(['quotations.reject']);
      expect(meta('convertToSalesOrder')).toBeUndefined();
    });

    it('has no route that sets a status directly', async () => {
      ctx.state.quotations.push(quote());
      await http()
        .patch(`/quotations/${QUOTE}/status`)
        .send({ status: 'APPROVED' })
        .expect(404);
      expect(ctx.state.quotations[0].status).toBe('DRAFT');
    });

    it('is enforced per action by the real PermissionsGuard', async () => {
      const mod = await Test.createTestingModule({
        controllers: [QuotationsController],
        providers: [
          QuotationsService,
          PermissionsGuard,
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
        .overrideGuard(RecordScopeGuard)
        .useValue(SCOPE_TESTED_ELSEWHERE)
        .compile();
      const guarded = mod.createNestApplication();
      guarded.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await guarded.init();

      ctx.state.quotations.push(quote());
      permissions = ['quotations.view'];

      const h = () => request(guarded.getHttpServer());
      await h().get('/quotations').expect(200);
      await h().get(`/quotations/${QUOTE}/events`).expect(200);
      await h().patch(`/quotations/${QUOTE}/approve`).send({}).expect(403);
      await h()
        .patch(`/quotations/${QUOTE}/reject`)
        .send({ reason: 'x' })
        .expect(403);
      await h()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 5 })
        .expect(403);
      await h().post('/quotations').send({}).expect(403);

      permissions = ['quotations.approve'];
      await h().get('/quotations').expect(403);
      await h()
        .patch(`/quotations/${QUOTE}/reject`)
        .send({ reason: 'x' })
        .expect(403);
      await h().patch(`/quotations/${QUOTE}/approve`).send({}).expect(200);

      expect(ctx.state.quotations[0].status).toBe('APPROVED');
      await guarded.close();
    });
  });

  describe('approve', () => {
    it.each(['DRAFT', 'REVISED'])(
      'approves a %s quotation and records who and when',
      async (status) => {
        ctx.state.quotations.push(quote({ status }));

        const res = await http()
          .patch(`/quotations/${QUOTE}/approve`)
          .send({ remarks: '  looks right  ' })
          .expect(200);

        expect(res.body.status).toBe('APPROVED');
        expect(ctx.state.events).toHaveLength(1);
        expect(ctx.state.events[0]).toMatchObject({
          quotationId: QUOTE,
          action: 'QUOTATION_APPROVED',
          fromStatus: status,
          toStatus: 'APPROVED',
          remarks: 'looks right',
          actorId: USER,
        });
        expect(ctx.state.events[0].occurredAt).toBeInstanceOf(Date);
      },
    );

    it('works without a body', async () => {
      ctx.state.quotations.push(quote());
      await http().patch(`/quotations/${QUOTE}/approve`).expect(200);
      expect(ctx.state.events[0].remarks).toBeUndefined();
    });

    it('is not repeatable, and a rejected quotation cannot be approved', async () => {
      ctx.state.quotations.push(quote({ status: 'APPROVED' }));
      const again = await http()
        .patch(`/quotations/${QUOTE}/approve`)
        .send({})
        .expect(409);
      expect(again.body.message).toMatch(/already approved/);

      ctx.state.quotations[0].status = 'REJECTED';
      const rejected = await http()
        .patch(`/quotations/${QUOTE}/approve`)
        .send({})
        .expect(409);
      expect(rejected.body.message).toMatch(/rejected/);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('refuses a legacy quotation whose tax breakdown does not add up', async () => {
      ctx.state.quotations.push(
        quote({
          status: 'DRAFT',
          taxableAmount: 0,
          gstPercent: 0,
          gstAmount: 0,
          totalAmount: 250000,
        }),
      );
      const res = await http()
        .patch(`/quotations/${QUOTE}/approve`)
        .send({})
        .expect(409);
      expect(res.body.message).toMatch(/tax breakdown/);
      expect(ctx.state.quotations[0].status).toBe('DRAFT');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('404s an unknown quotation', async () => {
      await http()
        .patch(`/quotations/${uid(77)}/approve`)
        .send({})
        .expect(404);
    });

    it('rejects a body that names an actor, a status or anything undeclared', async () => {
      ctx.state.quotations.push(quote());
      await http()
        .patch(`/quotations/${QUOTE}/approve`)
        .send({ actorId: 'someone-else' })
        .expect(400);
      await http()
        .patch(`/quotations/${QUOTE}/approve`)
        .send({ status: 'APPROVED' })
        .expect(400);
      await http()
        .patch(`/quotations/${QUOTE}/approve`)
        .send({ remarks: 'x'.repeat(501) })
        .expect(400);
      expect(ctx.state.quotations[0].status).toBe('DRAFT');
    });
  });

  describe('revise', () => {
    it.each(['DRAFT', 'REVISED'])(
      'recomputes GST and the total from the stored percentage on a %s quotation',
      async (status) => {
        ctx.state.quotations.push(quote({ status }));

        const res = await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send({ taxableAmount: 100000, remarks: 'negotiated' })
          .expect(200);

        expect(res.body).toMatchObject({
          status: 'REVISED',
          taxableAmount: 100000,
          gstPercent: 18,
          gstAmount: 18000,
          totalAmount: 118000,
        });
        expect(ctx.state.events[0]).toMatchObject({
          action: 'QUOTATION_REVISED',
          fromStatus: status,
          toStatus: 'REVISED',
          remarks: 'negotiated',
          previousTaxableAmount: 250000,
          newTaxableAmount: 100000,
          previousTotalAmount: 295000,
          newTotalAmount: 118000,
          actorId: USER,
        });
      },
    );

    it('does not accept a total, GST, percentage or status from the client', async () => {
      ctx.state.quotations.push(quote());
      for (const extra of [
        { totalAmount: 1 },
        { gstAmount: 1 },
        { gstPercent: 0 },
        { status: 'APPROVED' },
        { actorId: 'x' },
      ]) {
        await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send({ taxableAmount: 100, ...extra })
          .expect(400);
      }
      expect(ctx.state.quotations[0].totalAmount).toBe(295000);
    });

    it.each([
      ['missing', {}],
      ['zero', { taxableAmount: 0 }],
      ['negative', { taxableAmount: -5 }],
      ['a string', { taxableAmount: '100' }],
      ['more than two decimals', { taxableAmount: 10.123 }],
      ['absurdly large', { taxableAmount: 1e15 }],
      ['not finite', { taxableAmount: null }],
    ])('rejects a taxable amount that is %s', async (_n, body) => {
      ctx.state.quotations.push(quote());
      await http().patch(`/quotations/${QUOTE}/revise`).send(body).expect(400);
      expect(ctx.state.events).toHaveLength(0);
    });

    describe('a quotation with a priced line', () => {
      const line = (over: Row = {}): Row => ({
        id: 'line-1',
        quotationId: QUOTE,
        lineNumber: 1,
        inventoryItemId: 'item-1',
        description: 'Pump',
        hsnCode: '84137090',
        quantity: 10,
        unitRate: 25000,
        taxableAmount: 250000,
        gstRate: 18,
        cgstAmount: 0,
        sgstAmount: 0,
        igstAmount: 45000,
        gstAmount: 45000,
        totalAmount: 295000,
        ...over,
      });

      it('is revised by its unit rate: the line and the quotation take quantity x rate, GST and its split', async () => {
        ctx.state.quotations.push(quote({ taxType: 'IGST' }));
        ctx.state.lines.push(line());

        const res = await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send({ unitPrice: 12345.67 })
          .expect(200);

        // 10 x 12,345.67 = 1,23,456.70; GST 18% = 22,222.21 (rounded to the paisa)
        expect(res.body).toMatchObject({
          status: 'REVISED',
          taxableAmount: 123456.7,
          gstAmount: 22222.21,
          totalAmount: 145678.91,
        });
        expect(ctx.state.lines[0]).toMatchObject({
          quantity: 10,
          unitRate: 12345.67,
          taxableAmount: 123456.7,
          igstAmount: 22222.21,
          cgstAmount: 0,
          sgstAmount: 0,
          gstAmount: 22222.21,
          totalAmount: 145678.91,
        });
        expect(ctx.state.events[0]).toMatchObject({
          previousTaxableAmount: 250000,
          newTaxableAmount: 123456.7,
          newTotalAmount: 145678.91,
        });
      });

      it('splits CGST and SGST so they add up to the GST exactly', async () => {
        ctx.state.quotations.push(quote({ taxType: 'CGST_SGST' }));
        ctx.state.lines.push(
          line({ igstAmount: 0, cgstAmount: 22500, sgstAmount: 22500 }),
        );
        // 1 x 0.17 x 18% = 0.0306 -> GST 0.03: CGST 0.02 (half, rounded) + SGST 0.01
        ctx.state.lines[0].quantity = 1;
        await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send({ unitPrice: 0.17 })
          .expect(200);
        expect(ctx.state.lines[0]).toMatchObject({
          taxableAmount: 0.17,
          gstAmount: 0.03,
          cgstAmount: 0.02,
          sgstAmount: 0.01,
          igstAmount: 0,
        });
      });

      it.each([
        ['a taxable amount instead of a unit rate', { taxableAmount: 1000 }],
        ['both', { taxableAmount: 1000, unitPrice: 100 }],
        ['neither', {}],
      ])('refuses %s (400) and changes nothing', async (_n, body) => {
        ctx.state.quotations.push(quote({ taxType: 'IGST' }));
        ctx.state.lines.push(line());
        await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send(body)
          .expect(400);
        expect(ctx.state.lines[0].unitRate).toBe(25000);
        expect(ctx.state.quotations[0].taxableAmount).toBe(250000);
        expect(ctx.state.events).toHaveLength(0);
      });

      it('a quotation without lines refuses a unit rate (it has no quantity)', async () => {
        ctx.state.quotations.push(quote());
        const res = await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send({ unitPrice: 100 })
          .expect(400);
        expect(res.body.message).toMatch(/revise its taxable amount/);
        expect(ctx.state.events).toHaveLength(0);
      });
    });

    it('revises an APPROVED quotation back to REVISED when nothing is built on it', async () => {
      ctx.state.quotations.push(quote({ status: 'APPROVED' }));
      // a cancelled Proforma and a cancelled order do not count
      ctx.state.proformas.push({
        id: uid(21),
        quotationId: QUOTE,
        customerStatus: 'CANCELLED',
      });
      ctx.state.orders.push({
        id: uid(31),
        quotationId: QUOTE,
        proformaInvoiceId: uid(21),
        status: 'CANCELLED',
      });

      const res = await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 200000 })
        .expect(200);

      expect(res.body.status).toBe('REVISED');
      expect(ctx.state.events[0]).toMatchObject({
        fromStatus: 'APPROVED',
        toStatus: 'REVISED',
      });
    });

    it.each(['PENDING', 'APPROVED'])(
      'refuses an APPROVED quotation that has a %s Proforma',
      async (customerStatus) => {
        ctx.state.quotations.push(quote({ status: 'APPROVED' }));
        ctx.state.proformas.push({
          id: uid(21),
          quotationId: QUOTE,
          customerStatus,
        });

        const res = await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send({ taxableAmount: 100 })
          .expect(409);

        expect(res.body.message).toMatch(/active Proforma Invoice/);
        expect(ctx.state.quotations[0]).toMatchObject({
          status: 'APPROVED',
          totalAmount: 295000,
        });
        expect(ctx.state.events).toHaveLength(0);
      },
    );

    it('refuses an APPROVED quotation that has a live Sales Order, directly or through a Proforma', async () => {
      ctx.state.quotations.push(quote({ status: 'APPROVED' }));
      ctx.state.orders.push({
        id: uid(31),
        quotationId: QUOTE,
        status: 'OPEN',
      });
      const direct = await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 100 })
        .expect(409);
      expect(direct.body.message).toMatch(/a Sales Order/);

      ctx.state.orders.length = 0;
      ctx.state.proformas.push({
        id: uid(21),
        quotationId: QUOTE,
        customerStatus: 'CANCELLED',
      });
      ctx.state.orders.push({
        id: uid(32),
        quotationId: null,
        proformaInvoiceId: uid(21),
        status: 'PENDING_STORE_APPROVAL',
      });
      const viaProforma = await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 100 })
        .expect(409);
      expect(viaProforma.body.message).toMatch(/a Sales Order/);

      expect(ctx.state.quotations[0].status).toBe('APPROVED');
    });

    it('does not let downstream documents block a quotation that was never approved', async () => {
      ctx.state.quotations.push(quote({ status: 'REVISED' }));
      ctx.state.proformas.push({
        id: uid(21),
        quotationId: QUOTE,
        customerStatus: 'APPROVED',
      });
      await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 100 })
        .expect(200);
    });

    it('refuses a rejected quotation', async () => {
      ctx.state.quotations.push(quote({ status: 'REJECTED' }));
      const res = await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 100 })
        .expect(409);
      expect(res.body.message).toMatch(/rejected/);
    });

    it('refuses a legacy quotation with an inconsistent tax breakdown, whatever its status', async () => {
      for (const status of ['DRAFT', 'REVISED', 'APPROVED']) {
        ctx.state.quotations.length = 0;
        ctx.state.quotations.push(
          quote({
            status,
            taxableAmount: 0,
            gstPercent: 0,
            gstAmount: 0,
            totalAmount: 250000,
          }),
        );
        const res = await http()
          .patch(`/quotations/${QUOTE}/revise`)
          .send({ taxableAmount: 250000 })
          .expect(409);
        expect(res.body.message).toMatch(/tax breakdown/);
        expect(ctx.state.quotations[0]).toMatchObject({
          status,
          taxableAmount: 0,
          totalAmount: 250000,
        });
      }
      expect(ctx.state.events).toHaveLength(0);
    });
  });

  describe('reject', () => {
    it.each(['DRAFT', 'REVISED'])(
      'rejects a %s quotation with a mandatory reason',
      async (status) => {
        ctx.state.quotations.push(quote({ status }));

        const res = await http()
          .patch(`/quotations/${QUOTE}/reject`)
          .send({ reason: '  customer went elsewhere ' })
          .expect(200);

        expect(res.body.status).toBe('REJECTED');
        expect(ctx.state.events[0]).toMatchObject({
          action: 'QUOTATION_REJECTED',
          fromStatus: status,
          toStatus: 'REJECTED',
          remarks: 'customer went elsewhere',
          actorId: USER,
        });
      },
    );

    it('needs a non-blank reason', async () => {
      ctx.state.quotations.push(quote());
      for (const body of [
        {},
        { reason: '' },
        { reason: '   ' },
        { reason: 5 },
        { reason: 'x'.repeat(501) },
      ]) {
        await http()
          .patch(`/quotations/${QUOTE}/reject`)
          .send(body)
          .expect(400);
      }
      expect(ctx.state.quotations[0].status).toBe('DRAFT');
    });

    it('is terminal, and an approved quotation must be revised before it can be rejected', async () => {
      ctx.state.quotations.push(quote({ status: 'APPROVED' }));
      const approved = await http()
        .patch(`/quotations/${QUOTE}/reject`)
        .send({ reason: 'no' })
        .expect(409);
      expect(approved.body.message).toMatch(/Revise it first/);

      ctx.state.quotations[0].status = 'REJECTED';
      const again = await http()
        .patch(`/quotations/${QUOTE}/reject`)
        .send({ reason: 'no' })
        .expect(409);
      expect(again.body.message).toMatch(/already rejected/);
      await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 5 })
        .expect(409);
      await http().patch(`/quotations/${QUOTE}/approve`).send({}).expect(409);
      expect(ctx.state.events).toHaveLength(0);
    });
  });

  describe('actor and atomicity', () => {
    it('needs a signed-in user that exists', async () => {
      ctx.state.quotations.push(quote());
      userId = undefined;
      await http().patch(`/quotations/${QUOTE}/approve`).send({}).expect(401);
      userId = 'ghost';
      await http().patch(`/quotations/${QUOTE}/approve`).send({}).expect(401);
      expect(ctx.state.quotations[0].status).toBe('DRAFT');
    });

    it('rolls the status change back when its event cannot be written', async () => {
      ctx.state.quotations.push(quote());
      ctx.state.eventFailure = true;

      await http().patch(`/quotations/${QUOTE}/approve`).send({}).expect(500);
      expect(ctx.state.quotations[0].status).toBe('DRAFT');

      await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 100 })
        .expect(500);
      expect(ctx.state.quotations[0]).toMatchObject({
        status: 'DRAFT',
        totalAmount: 295000,
      });
      expect(ctx.state.events).toHaveLength(0);
    });

    it('moves only if the quotation is still where the lock read it (compare-and-set)', async () => {
      ctx.state.quotations.push(quote());
      // The lock read says DRAFT, but the row has moved by the time of the update.
      const realQuery = ctx.db.$queryRaw;
      ctx.db.$queryRaw = async (...a: any[]) => {
        const rows = await realQuery(...a);
        ctx.state.quotations[0].status = 'REJECTED';
        return rows.map(() => ({ status: 'DRAFT' }));
      };

      const res = await http()
        .patch(`/quotations/${QUOTE}/approve`)
        .send({})
        .expect(409);
      expect(res.body.message).toMatch(/rejected/);
      // (the fake database restores its snapshot on a failed transaction, so it
      // can only show that the approval was not applied)
      expect(ctx.state.quotations[0].status).not.toBe('APPROVED');
      expect(ctx.state.events).toHaveLength(0);
    });
  });

  describe('history', () => {
    it('lists events newest first with only the actor id and name', async () => {
      ctx.state.quotations.push(quote());
      await http()
        .patch(`/quotations/${QUOTE}/revise`)
        .send({ taxableAmount: 100 })
        .expect(200);
      await http().patch(`/quotations/${QUOTE}/approve`).send({}).expect(200);

      const res = await http().get(`/quotations/${QUOTE}/events`).expect(200);

      expect(res.body.map((e: Row) => e.action)).toEqual([
        'QUOTATION_APPROVED',
        'QUOTATION_REVISED',
      ]);
      expect(res.body[0].actor).toEqual({
        id: USER,
        fullName: 'Asha Approver',
      });
    });

    it('404s the history of an unknown quotation', async () => {
      await http()
        .get(`/quotations/${uid(77)}/events`)
        .expect(404);
    });
  });
});
