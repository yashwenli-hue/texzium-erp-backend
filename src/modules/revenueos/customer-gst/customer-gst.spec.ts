/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { CustomerGstController } from './customer-gst.controller';
import { CustomerGstService } from './customer-gst.service';
import {
  GSTIN_PATTERN,
  GST_STATES,
  PINCODE_PATTERN,
  diffGstFields,
  gstinMatchesPan,
  gstinPan,
  gstinState,
  normalizeGstin,
} from './customer-gst-values';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USER = 'user-1';
// revenue.view.all: an administrator, who sees every customer a refusal may name
const ALL_PERMISSIONS = [
  'customers.view',
  'customers.gst.manage',
  'revenue.view.all',
];

const RAJ = uid(1);
const ABC = uid(2);

// ---------------------------------------------------------------------------
// The pure rules
// ---------------------------------------------------------------------------

describe('GST registration rules', () => {
  it('accepts the GSTINs on file and rejects malformed ones', () => {
    for (const g of ['24XYZAB1234K1Z1', '27XYZAB1234K1Z8', '27ABCDE1234F1Z5']) {
      expect(GSTIN_PATTERN.test(g)).toBe(true);
    }
    for (const g of [
      '24xyzab1234k1z1',
      '24XYZAB1234K1Z',
      '24XYZAB1234K1Y1',
      '24XYZAB1234K0Z1',
      'XXXYZAB1234K1Z1',
      '',
    ]) {
      expect(GSTIN_PATTERN.test(g)).toBe(false);
    }
  });

  it('reads the state from the first two digits, with the names on file today', () => {
    expect(gstinState('24XYZAB1234K1Z1')).toEqual({
      stateCode: '24',
      stateName: 'Gujarat',
    });
    expect(gstinState('27XYZAB1234K1Z8')).toEqual({
      stateCode: '27',
      stateName: 'Maharashtra',
    });
    for (const code of ['00', '25', '28', '39', '99']) {
      expect(gstinState(`${code}XYZAB1234K1Z1`)).toBeNull();
    }
    expect(Object.keys(GST_STATES)).toHaveLength(37);
  });

  it('reads the PAN a GSTIN carries and compares it with the customer', () => {
    expect(gstinPan('24XYZAB1234K1Z1')).toBe('XYZAB1234K');
    expect(gstinMatchesPan('24XYZAB1234K1Z1', 'XYZAB1234K')).toBe(true);
    expect(gstinMatchesPan('24XYZAB1234K1Z1', ' xyzab1234k ')).toBe(true);
    expect(gstinMatchesPan('24XYZAB1234K1Z1', 'ABCDE9999F')).toBe(false);
    expect(gstinMatchesPan('24XYZAB1234K1Z1', null)).toBe(true);
    expect(gstinMatchesPan('24XYZAB1234K1Z1', '')).toBe(true);
  });

  it('normalises a GSTIN and checks PIN codes', () => {
    expect(normalizeGstin(' 24xyzab1234k1z1 ')).toBe('24XYZAB1234K1Z1');
    expect(PINCODE_PATTERN.test('382330')).toBe(true);
    for (const p of ['012345', '12345', '1234567', '38233a', '']) {
      expect(PINCODE_PATTERN.test(p)).toBe(false);
    }
  });

  it('diffs only the fields that are present and different', () => {
    const current = {
      legalName: 'Raj Traders',
      tradeName: null,
      branchName: 'Raj Gujarat',
      addressLine1: '1 Main Road',
      addressLine2: null,
      city: 'Ahmedabad',
      pincode: '382330',
    };

    expect(diffGstFields(current, {})).toEqual({});
    expect(
      diffGstFields(current, { city: 'Ahmedabad', tradeName: undefined }),
    ).toEqual({});
    expect(
      diffGstFields(current, {
        city: 'Surat',
        branchName: null,
        tradeName: 'RT',
      }),
    ).toEqual({
      city: { from: 'Ahmedabad', to: 'Surat' },
      branchName: { from: 'Raj Gujarat', to: null },
      tradeName: { from: null, to: 'RT' },
    });
  });
});

// ---------------------------------------------------------------------------
// A small fake database
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeDb() {
  const state: {
    customers: Row[];
    gst: Row[];
    events: Row[];
    users: Row[];
    eventFailure: boolean;
    failGstinOnce: boolean;
    betweenLockAndWrite: (() => void) | null;
  } = {
    customers: [],
    gst: [],
    events: [],
    users: [{ id: USER, fullName: 'Asha Admin' }],
    eventFailure: false,
    failGstinOnce: false,
    betweenLockAndWrite: null,
  };

  const p2002 = (target: unknown) =>
    Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target },
    });

  const pick = (row: Row | undefined | null, select?: Row) => {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k])
        .map((k) => {
          if (k === 'customer') {
            return [
              k,
              pick(
                state.customers.find((c) => c.id === row.customerId),
                select.customer.select,
              ),
            ];
          }
          return [k, row[k]];
        }),
    );
  };

  const withInclude = (row: Row | undefined, include?: Row) => {
    if (!row) return null;
    const out = { ...row };
    if (include?.customer) {
      out.customer = pick(
        state.customers.find((c) => c.id === row.customerId),
        include.customer.select,
      );
    }
    return out;
  };

  const matches = (r: Row, where: Row = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'id' && v && typeof v === 'object') return r.id !== v.not;
      return r[k] === v;
    });

  let counter = 1000;

  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
      if (strings.join('?').includes('customer:lock')) {
        const c = state.customers.find((x) => x.id === v[0]);
        return c ? [{ isActive: c.isActive }] : [];
      }
      throw new Error('unexpected raw query');
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = JSON.stringify({ g: state.gst, e: state.events });
      try {
        return await fn(db);
      } catch (e) {
        const s = JSON.parse(snapshot);
        state.gst = s.g.map((g: Row) => ({
          ...g,
          createdAt: new Date(g.createdAt),
          updatedAt: new Date(g.updatedAt),
        }));
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
    customer: {
      findUniqueOrThrow: async ({ where, select }: any) => {
        const row = state.customers.find((c) => c.id === where.id);
        if (!row) throw new Error('not found');
        return pick(row, select);
      },
    },
    customerGSTRegistration: {
      findUnique: async ({ where, select, include }: any) => {
        const row = state.gst.find((g) =>
          where.id ? g.id === where.id : g.gstin === where.gstin,
        );
        return select ? pick(row, select) : withInclude(row, include);
      },
      findUniqueOrThrow: async ({ where }: any) => {
        const row = state.gst.find((g) => g.id === where.id);
        if (!row) throw new Error('not found');
        return { ...row };
      },
      findFirst: async ({ where, select }: any) =>
        pick(
          state.gst.find((g) => matches(g, where)),
          select,
        ),
      findMany: async ({ where, include }: any) =>
        state.gst
          .filter((g) => matches(g, where))
          .map((g) => withInclude(g, include)),
      count: async ({ where }: any) =>
        state.gst.filter((g) => matches(g, where)).length,
      create: async ({ data }: any) => {
        if (state.failGstinOnce) {
          state.failGstinOnce = false;
          throw p2002(['gstin']);
        }
        if (state.gst.some((g) => g.gstin === data.gstin)) {
          throw p2002(['gstin']);
        }
        if (
          data.isDefault &&
          data.isActive &&
          state.gst.some(
            (g) =>
              g.customerId === data.customerId && g.isDefault && g.isActive,
          )
        ) {
          throw p2002(['customerId']);
        }
        const now = new Date();
        const row = {
          id: uid((counter += 1)),
          tradeName: null,
          branchName: null,
          addressLine2: null,
          createdAt: now,
          updatedAt: now,
          ...Object.fromEntries(
            Object.entries(data).map(([k, v]) => [
              k,
              v === undefined ? null : v,
            ]),
          ),
        };
        state.gst.push(row);
        return { ...row };
      },
      update: async ({ where, data }: any) => {
        const row = state.gst.find((g) => g.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        state.betweenLockAndWrite?.();
        const rows = state.gst.filter((g) => matches(g, where));
        for (const r of rows) {
          if (
            data.isDefault === true &&
            (data.isActive ?? r.isActive) &&
            state.gst.some(
              (g) =>
                g.id !== r.id &&
                g.customerId === r.customerId &&
                g.isDefault &&
                g.isActive,
            )
          ) {
            throw p2002(['customerId']);
          }
          Object.assign(r, data, { updatedAt: new Date() });
        }
        return { count: rows.length };
      },
    },
    // Who looks after / created a customer named in a conflict (customer-relationship.ts):
    // no opportunities and no recorded creators here.
    opportunity: { findMany: async () => [] },
    customerEvent: {
      findMany: async () => [],
      create: async ({ data }: any) => {
        if (state.eventFailure) throw new Error('event failed');
        const row = { id: uid((counter += 1)), createdAt: new Date(), ...data };
        state.events.push(row);
        return row;
      },
    },
  };

  return { db, state };
}

const customer = (over: Row = {}): Row => ({
  id: RAJ,
  customerCode: 'CUST001',
  customerName: 'Raj Traders',
  panNumber: 'XYZAB1234K',
  email: 'raj@traders.com',
  isActive: true,
  ...over,
});

const gstRow = (over: Row = {}): Row => ({
  id: uid(50),
  customerId: RAJ,
  gstin: '24XYZAB1234K1Z1',
  legalName: 'Raj Traders',
  tradeName: null,
  branchName: 'Raj Gujarat',
  stateCode: '24',
  stateName: 'Gujarat',
  addressLine1: '1 Main Road',
  addressLine2: null,
  city: 'Ahmedabad',
  pincode: '382330',
  isDefault: true,
  isActive: true,
  createdAt: new Date('2026-06-30T05:20:00Z'),
  updatedAt: new Date('2026-06-30T05:20:00Z'),
  ...over,
});

const body = (over: Row = {}): Row => ({
  customerId: RAJ,
  gstin: '27XYZAB1234K1Z8',
  legalName: 'Raj Traders',
  branchName: 'Raj Mumbai',
  addressLine1: '5 Marine Drive',
  city: 'Mumbai',
  pincode: '400601',
  ...over,
});

// ---------------------------------------------------------------------------
// Over HTTP
// ---------------------------------------------------------------------------

describe('Customer GST registrations over HTTP', () => {
  let app: INestApplication;
  let ctx: ReturnType<typeof makeDb>;
  let permissions: string[];
  let userId: string | undefined;

  const build = async (withRealGuard: boolean) => {
    const mod = await Test.createTestingModule({
      controllers: [CustomerGstController],
      providers: [
        CustomerGstService,
        ...(withRealGuard ? [PermissionsGuard] : []),
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
    ctx.state.customers.push(customer());
    permissions = ALL_PERMISSIONS;
    userId = USER;
    app = await build(false);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const G1 = uid(50);
  const G2 = uid(51);
  const events = () => ctx.state.events.map((e) => e.action);

  describe('permissions', () => {
    it('declares one permission on every route', () => {
      const proto = CustomerGstController.prototype as any;
      const meta = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);

      expect(meta('create')).toEqual(['customers.gst.manage']);
      expect(meta('findAll')).toEqual(['customers.view']);
      expect(meta('findOne')).toEqual(['customers.view']);
      expect(meta('update')).toEqual(['customers.gst.manage']);
      expect(meta('deactivate')).toEqual(['customers.gst.manage']);
      expect(meta('reactivate')).toEqual(['customers.gst.manage']);
      expect(meta('setDefault')).toEqual(['customers.gst.manage']);
    });

    it('is enforced per action by the real PermissionsGuard', async () => {
      const guarded = await build(true);
      ctx.state.gst.push(gstRow());
      const h = () => request(guarded.getHttpServer());

      permissions = ['customers.view'];
      await h().get('/customer-gst').expect(200);
      await h().get(`/customer-gst/${G1}`).expect(200);
      await h().post('/customer-gst').send(body()).expect(403);
      await h()
        .patch(`/customer-gst/${G1}`)
        .send({ city: 'Surat' })
        .expect(403);
      await h()
        .patch(`/customer-gst/${G1}/deactivate`)
        .send({ reason: 'r' })
        .expect(403);
      await h().patch(`/customer-gst/${G1}/reactivate`).send({}).expect(403);
      await h().patch(`/customer-gst/${G1}/default`).expect(403);

      permissions = ['customers.gst.manage'];
      await h().get('/customer-gst').expect(403);
      await h().post('/customer-gst').send(body()).expect(201);
      await h()
        .patch(`/customer-gst/${G1}`)
        .send({ city: 'Surat' })
        .expect(200);

      permissions = [];
      await h().get('/customer-gst').expect(403);
      await h().post('/customer-gst').send(body()).expect(403);
      await guarded.close();
    });
  });

  describe('create', () => {
    it("makes a customer's first registration its default and reads the state from the GSTIN", async () => {
      const res = await http().post('/customer-gst').send(body()).expect(201);

      expect(res.body).toMatchObject({
        customerId: RAJ,
        gstin: '27XYZAB1234K1Z8',
        stateCode: '27',
        stateName: 'Maharashtra',
        isDefault: true,
        isActive: true,
        branchName: 'Raj Mumbai',
      });
      expect(ctx.state.events).toHaveLength(1);
      expect(ctx.state.events[0]).toMatchObject({
        customerId: RAJ,
        action: 'GST_ADDED',
        toStatus: 'ACTIVE',
        gstRegistrationId: res.body.id,
        actorId: USER,
      });
    });

    it('keeps a later registration out of the default unless asked, even when isDefault is sent false', async () => {
      ctx.state.gst.push(gstRow());

      const plain = await http().post('/customer-gst').send(body()).expect(201);
      expect(plain.body.isDefault).toBe(false);

      const no = await http()
        .post('/customer-gst')
        .send(
          body({
            gstin: '29XYZAB1234K1Z4',
            city: 'Bengaluru',
            isDefault: false,
          }),
        )
        .expect(201);
      expect(no.body.isDefault).toBe(false);
      expect(ctx.state.gst.filter((g) => g.isDefault)).toHaveLength(1);
      expect(events()).toEqual(['GST_ADDED', 'GST_ADDED']);
    });

    it('takes the default over from the current one when asked, and records the change', async () => {
      ctx.state.gst.push(gstRow());

      const res = await http()
        .post('/customer-gst')
        .send(body({ isDefault: true }))
        .expect(201);

      expect(res.body.isDefault).toBe(true);
      expect(ctx.state.gst.find((g) => g.id === G1)!.isDefault).toBe(false);
      expect(
        ctx.state.gst.filter((g) => g.isDefault && g.isActive),
      ).toHaveLength(1);
      expect(events()).toEqual(['GST_ADDED', 'GST_DEFAULT_CHANGED']);
      expect(ctx.state.events[1]).toMatchObject({
        gstRegistrationId: res.body.id,
        changes: {
          defaultGstin: { from: '24XYZAB1234K1Z1', to: '27XYZAB1234K1Z8' },
        },
      });
    });

    it('makes the new registration the default when the customer has none active', async () => {
      ctx.state.gst.push(gstRow({ isActive: false, isDefault: false }));
      const res = await http().post('/customer-gst').send(body()).expect(201);
      expect(res.body.isDefault).toBe(true);
    });

    it('normalises what it stores', async () => {
      const res = await http()
        .post('/customer-gst')
        .send(
          body({
            gstin: ' 27xyzab1234k1z8 ',
            legalName: '  Raj Traders  ',
            tradeName: ' ',
            addressLine2: '',
            city: ' Mumbai ',
          }),
        )
        .expect(201);

      expect(res.body).toMatchObject({
        gstin: '27XYZAB1234K1Z8',
        legalName: 'Raj Traders',
        tradeName: null,
        addressLine2: null,
        city: 'Mumbai',
      });
    });

    it.each([
      ['no body', {}],
      ['a malformed GSTIN', body({ gstin: '27XYZAB1234K1Y8' })],
      ['a short GSTIN', body({ gstin: '27XYZAB1234K1Z' })],
      ['a blank legal name', body({ legalName: '  ' })],
      ['a blank address', body({ addressLine1: '' })],
      ['a blank city', body({ city: '' })],
      ['a malformed PIN code', body({ pincode: '12345' })],
      ['a customer id that is not a uuid', body({ customerId: 'raj' })],
      ['a client supplied state code', body({ stateCode: '27' })],
      ['a client supplied state name', body({ stateName: 'Maharashtra' })],
      ['an active flag', body({ isActive: false })],
      ['an id', body({ id: uid(9) })],
      ['a non boolean default', body({ isDefault: 'yes' })],
    ])('refuses %s', async (_label, payload) => {
      await http().post('/customer-gst').send(payload).expect(400);
      expect(ctx.state.gst).toHaveLength(0);
      expect(ctx.state.events).toHaveLength(0);
    });

    it.each(['00', '25', '28', '39', '99'])(
      'refuses a GSTIN whose state code %s cannot be issued',
      async (code) => {
        const res = await http()
          .post('/customer-gst')
          .send(body({ gstin: `${code}XYZAB1234K1Z8` }))
          .expect(400);
        expect(res.body.code).toBe('INVALID_STATE_CODE');
      },
    );

    it("refuses a GSTIN that carries another PAN than the customer's", async () => {
      const res = await http()
        .post('/customer-gst')
        .send(body({ gstin: '27ABCDE9999F1Z5' }))
        .expect(400);
      expect(res.body.code).toBe('GSTIN_PAN_MISMATCH');
      expect(ctx.state.gst).toHaveLength(0);
    });

    it('takes any PAN from a customer that has none', async () => {
      ctx.state.customers[0].panNumber = null;
      await http()
        .post('/customer-gst')
        .send(body({ gstin: '27ABCDE9999F1Z5' }))
        .expect(201);
    });

    it('refuses a GSTIN that is already registered, to the same or another customer', async () => {
      ctx.state.customers.push(
        customer({
          id: ABC,
          customerCode: 'CUST002',
          customerName: 'ABC Industrial',
          panNumber: null,
        }),
      );
      ctx.state.gst.push(gstRow());

      const other = await http()
        .post('/customer-gst')
        .send(body({ customerId: ABC, gstin: '24xyzab1234k1z1' }))
        .expect(409);
      expect(other.body).toMatchObject({
        code: 'DUPLICATE_GSTIN',
        existing: {
          id: G1,
          gstin: '24XYZAB1234K1Z1',
          customerId: RAJ,
          customerCode: 'CUST001',
          customerName: 'Raj Traders',
        },
      });
      expect(other.body.message).toMatch(/Raj Traders/);

      await http()
        .post('/customer-gst')
        .send(body({ gstin: '24XYZAB1234K1Z1' }))
        .expect(409);
      expect(ctx.state.gst).toHaveLength(1);
    });

    it('turns a GSTIN the database refuses (a race) into a GSTIN conflict', async () => {
      ctx.state.gst.push(gstRow());
      ctx.state.failGstinOnce = true;
      const res = await http()
        .post('/customer-gst')
        .send(body({ gstin: '24XYZAB1234K1Z1' }))
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE_GSTIN');
      expect(res.body.existing.id).toBe(G1);
    });

    it('is 404 for an unknown customer and refuses an inactive one', async () => {
      await http()
        .post('/customer-gst')
        .send(body({ customerId: uid(404) }))
        .expect(404);

      ctx.state.customers[0].isActive = false;
      const res = await http().post('/customer-gst').send(body()).expect(409);
      expect(res.body.code).toBe('CUSTOMER_INACTIVE');
      expect(ctx.state.gst).toHaveLength(0);
    });

    it('needs a signed-in user that exists', async () => {
      userId = undefined;
      await http().post('/customer-gst').send(body()).expect(401);
      userId = 'ghost';
      await http().post('/customer-gst').send(body()).expect(401);
      expect(ctx.state.gst).toHaveLength(0);
    });

    it('changes nothing when its event cannot be recorded, including the default it would have taken', async () => {
      ctx.state.gst.push(gstRow());
      ctx.state.eventFailure = true;
      await http()
        .post('/customer-gst')
        .send(body({ isDefault: true }))
        .expect(500);
      expect(ctx.state.gst).toHaveLength(1);
      expect(ctx.state.gst[0].isDefault).toBe(true);
    });
  });

  describe('read', () => {
    it('lists registrations with the owning customer, and no more of it than needed', async () => {
      ctx.state.gst.push(gstRow());
      const res = await http().get('/customer-gst').expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].customer).toEqual({
        id: RAJ,
        customerCode: 'CUST001',
        customerName: 'Raj Traders',
        isActive: true,
      });
    });

    it('returns one registration, or 404', async () => {
      ctx.state.gst.push(gstRow());
      const res = await http().get(`/customer-gst/${G1}`).expect(200);
      expect(res.body).toMatchObject({ id: G1, gstin: '24XYZAB1234K1Z1' });
      await http()
        .get(`/customer-gst/${uid(404)}`)
        .expect(404);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      ctx.state.gst.push(gstRow());
    });

    it('writes only the fields that change and records them', async () => {
      const res = await http()
        .patch(`/customer-gst/${G1}`)
        .send({
          city: 'Surat',
          pincode: '395003',
          tradeName: 'RT',
          legalName: 'Raj Traders',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        city: 'Surat',
        pincode: '395003',
        tradeName: 'RT',
      });
      expect(ctx.state.events).toHaveLength(1);
      expect(ctx.state.events[0]).toMatchObject({
        action: 'GST_UPDATED',
        fromStatus: 'ACTIVE',
        toStatus: 'ACTIVE',
        gstRegistrationId: G1,
        actorId: USER,
        changes: {
          city: { from: 'Ahmedabad', to: 'Surat' },
          pincode: { from: '382330', to: '395003' },
          tradeName: { from: null, to: 'RT' },
        },
      });
      expect(Object.keys(ctx.state.events[0].changes).sort()).toEqual([
        'city',
        'pincode',
        'tradeName',
      ]);
    });

    it('does nothing, and records nothing, for an empty or unchanged edit', async () => {
      await http().patch(`/customer-gst/${G1}`).send({}).expect(200);
      await http()
        .patch(`/customer-gst/${G1}`)
        .send({ city: 'Ahmedabad' })
        .expect(200);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('clears an optional field sent blank or null, but never a required one', async () => {
      const res = await http()
        .patch(`/customer-gst/${G1}`)
        .send({ branchName: '', addressLine2: null })
        .expect(200);
      expect(res.body.branchName).toBeNull();

      for (const payload of [
        { legalName: ' ' },
        { addressLine1: '' },
        { city: null },
        { pincode: null },
      ]) {
        await http().patch(`/customer-gst/${G1}`).send(payload).expect(400);
      }
    });

    it.each([
      ['the GSTIN', { gstin: '27XYZAB1234K1Z8' }],
      ['the state code', { stateCode: '27' }],
      ['the state name', { stateName: 'Maharashtra' }],
      ['the owner', { customerId: uid(2) }],
      ['the active flag', { isActive: false }],
      ['the default flag', { isDefault: false }],
      ['a malformed PIN code', { pincode: '123' }],
      ['an unknown field', { gstType: 'REGULAR' }],
    ])('refuses to set %s', async (_label, payload) => {
      await http().patch(`/customer-gst/${G1}`).send(payload).expect(400);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('refuses to edit an inactive registration, or one of an inactive customer', async () => {
      ctx.state.gst[0].isActive = false;
      ctx.state.gst[0].isDefault = false;
      const a = await http()
        .patch(`/customer-gst/${G1}`)
        .send({ city: 'Surat' })
        .expect(409);
      expect(a.body.code).toBe('GST_INACTIVE');

      ctx.state.gst[0].isActive = true;
      ctx.state.customers[0].isActive = false;
      const b = await http()
        .patch(`/customer-gst/${G1}`)
        .send({ city: 'Surat' })
        .expect(409);
      expect(b.body.code).toBe('CUSTOMER_INACTIVE');
      expect(ctx.state.gst[0].city).toBe('Ahmedabad');
    });

    it('is 404 for an unknown registration, and needs a signed-in user', async () => {
      await http()
        .patch(`/customer-gst/${uid(404)}`)
        .send({ city: 'Surat' })
        .expect(404);
      userId = undefined;
      await http()
        .patch(`/customer-gst/${G1}`)
        .send({ city: 'Surat' })
        .expect(401);
    });

    it('leaves the registration unchanged when its event cannot be recorded', async () => {
      ctx.state.eventFailure = true;
      await http()
        .patch(`/customer-gst/${G1}`)
        .send({ city: 'Surat' })
        .expect(500);
      expect(ctx.state.gst[0].city).toBe('Ahmedabad');
    });
  });

  describe('deactivate and reactivate', () => {
    beforeEach(() => {
      ctx.state.gst.push(gstRow());
      ctx.state.gst.push(
        gstRow({
          id: G2,
          gstin: '27XYZAB1234K1Z8',
          stateCode: '27',
          stateName: 'Maharashtra',
          branchName: 'Raj Mumbai',
          isDefault: false,
        }),
      );
    });

    it('deactivates a registration that is not the default, with a reason', async () => {
      const res = await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: '  Branch closed  ' })
        .expect(200);

      expect(res.body).toMatchObject({ isActive: false, isDefault: false });
      expect(ctx.state.events[0]).toMatchObject({
        action: 'GST_DEACTIVATED',
        fromStatus: 'ACTIVE',
        toStatus: 'INACTIVE',
        remarks: 'Branch closed',
        gstRegistrationId: G2,
        actorId: USER,
      });
    });

    it('needs a reason', async () => {
      await http().patch(`/customer-gst/${G2}/deactivate`).send({}).expect(400);
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: ' ' })
        .expect(400);
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'x'.repeat(501) })
        .expect(400);
      expect(ctx.state.gst[1].isActive).toBe(true);
    });

    it('will not deactivate the default while another registration is active', async () => {
      const res = await http()
        .patch(`/customer-gst/${G1}/deactivate`)
        .send({ reason: 'r' })
        .expect(409);
      expect(res.body.code).toBe('GST_IS_DEFAULT');
      expect(ctx.state.gst[0]).toMatchObject({
        isActive: true,
        isDefault: true,
      });
    });

    it('lets the only active registration be deactivated, and then it is no longer the default', async () => {
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      const res = await http()
        .patch(`/customer-gst/${G1}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      expect(res.body).toMatchObject({ isActive: false, isDefault: false });
      expect(
        ctx.state.gst.filter((g) => g.isActive || g.isDefault),
      ).toHaveLength(0);
    });

    it('cannot deactivate twice, or an unknown registration', async () => {
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      const again = await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(409);
      expect(again.body.code).toBe('GST_ALREADY_INACTIVE');
      expect(events()).toEqual(['GST_DEACTIVATED']);
      await http()
        .patch(`/customer-gst/${uid(404)}/deactivate`)
        .send({ reason: 'r' })
        .expect(404);
    });

    it('refuses both for an inactive customer', async () => {
      ctx.state.customers[0].isActive = false;
      const res = await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(409);
      expect(res.body.code).toBe('CUSTOMER_INACTIVE');
    });

    it('reactivates as a normal registration while the customer has a default', async () => {
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      const res = await http()
        .patch(`/customer-gst/${G2}/reactivate`)
        .send({ remarks: ' Trading again ' })
        .expect(200);

      expect(res.body).toMatchObject({ isActive: true, isDefault: false });
      expect(events()).toEqual(['GST_DEACTIVATED', 'GST_REACTIVATED']);
      expect(ctx.state.events[1]).toMatchObject({
        fromStatus: 'INACTIVE',
        toStatus: 'ACTIVE',
        remarks: 'Trading again',
      });
    });

    it('reactivates as the default when the customer has none', async () => {
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      await http()
        .patch(`/customer-gst/${G1}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);

      const res = await http()
        .patch(`/customer-gst/${G2}/reactivate`)
        .send({})
        .expect(200);
      expect(res.body.isDefault).toBe(true);
      expect(events().slice(-2)).toEqual([
        'GST_REACTIVATED',
        'GST_DEFAULT_CHANGED',
      ]);
      expect(ctx.state.events.at(-1)!.changes).toEqual({
        defaultGstin: { from: null, to: '27XYZAB1234K1Z8' },
      });
    });

    it("will not reactivate a registration that no longer agrees with the customer's PAN", async () => {
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      ctx.state.customers[0].panNumber = 'ABCDE9999F';
      const res = await http()
        .patch(`/customer-gst/${G2}/reactivate`)
        .send({})
        .expect(400);
      expect(res.body.code).toBe('GSTIN_PAN_MISMATCH');
      expect(ctx.state.gst[1].isActive).toBe(false);
    });

    it('cannot reactivate an active registration', async () => {
      const res = await http()
        .patch(`/customer-gst/${G2}/reactivate`)
        .send({})
        .expect(409);
      expect(res.body.code).toBe('GST_ALREADY_ACTIVE');
    });

    it('does not apply a deactivation to a registration that moved on after the lock', async () => {
      ctx.state.betweenLockAndWrite = () => {
        ctx.state.gst[1].isActive = false;
        ctx.state.betweenLockAndWrite = null;
      };
      const res = await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(409);
      expect(res.body.code).toBe('GST_ALREADY_INACTIVE');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('does not apply a reactivation to a registration that moved on after the lock', async () => {
      ctx.state.gst[1].isActive = false;
      ctx.state.betweenLockAndWrite = () => {
        ctx.state.gst[1].isActive = true;
        ctx.state.betweenLockAndWrite = null;
      };
      const res = await http()
        .patch(`/customer-gst/${G2}/reactivate`)
        .send({})
        .expect(409);
      expect(res.body.code).toBe('GST_ALREADY_ACTIVE');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('records nothing when the event cannot be recorded', async () => {
      ctx.state.eventFailure = true;
      await http()
        .patch(`/customer-gst/${G2}/deactivate`)
        .send({ reason: 'r' })
        .expect(500);
      expect(ctx.state.gst[1].isActive).toBe(true);
    });
  });

  describe('default', () => {
    beforeEach(() => {
      ctx.state.gst.push(gstRow());
      ctx.state.gst.push(
        gstRow({
          id: G2,
          gstin: '27XYZAB1234K1Z8',
          stateCode: '27',
          stateName: 'Maharashtra',
          isDefault: false,
        }),
      );
    });

    it('moves the default and records from and to', async () => {
      const res = await http().patch(`/customer-gst/${G2}/default`).expect(200);

      expect(res.body.isDefault).toBe(true);
      expect(ctx.state.gst[0].isDefault).toBe(false);
      expect(
        ctx.state.gst.filter((g) => g.isDefault && g.isActive),
      ).toHaveLength(1);
      expect(ctx.state.events).toHaveLength(1);
      expect(ctx.state.events[0]).toMatchObject({
        action: 'GST_DEFAULT_CHANGED',
        gstRegistrationId: G2,
        changes: {
          defaultGstin: { from: '24XYZAB1234K1Z1', to: '27XYZAB1234K1Z8' },
        },
      });
    });

    it('does nothing for the registration that already is the default', async () => {
      await http().patch(`/customer-gst/${G1}/default`).expect(200);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('refuses an inactive registration, an unknown one, or an inactive customer', async () => {
      ctx.state.gst[1].isActive = false;
      const a = await http().patch(`/customer-gst/${G2}/default`).expect(409);
      expect(a.body.code).toBe('GST_INACTIVE');

      await http()
        .patch(`/customer-gst/${uid(404)}/default`)
        .expect(404);

      ctx.state.gst[1].isActive = true;
      ctx.state.customers[0].isActive = false;
      const b = await http().patch(`/customer-gst/${G2}/default`).expect(409);
      expect(b.body.code).toBe('CUSTOMER_INACTIVE');
      expect(ctx.state.gst[0].isDefault).toBe(true);
    });

    it('leaves the old default in place when its event cannot be recorded', async () => {
      ctx.state.eventFailure = true;
      await http().patch(`/customer-gst/${G2}/default`).expect(500);
      expect(ctx.state.gst[0].isDefault).toBe(true);
      expect(ctx.state.gst[1].isDefault).toBe(false);
    });

    it('needs a signed-in user', async () => {
      userId = undefined;
      await http().patch(`/customer-gst/${G2}/default`).expect(401);
    });
  });
});
