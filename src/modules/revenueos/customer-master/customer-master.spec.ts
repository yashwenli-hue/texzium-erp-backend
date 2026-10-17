/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { CustomerMasterController } from './customer-master.controller';
import { CustomerMasterService } from './customer-master.service';
import { CustomerOverviewService } from './customer-overview.service';
import {
  PAN_PATTERN,
  PHONE_PATTERN,
  diffCustomerFields,
  formatCustomerCode,
  normalizeCustomerName,
  normalizeEmail,
  normalizePan,
  samePhone,
} from './customer-values';
import { isUniqueViolation } from './customer-lifecycle';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USER = 'user-1';
const ALL_PERMISSIONS = [
  // administrators: refusals name the existing customer (hidden from scoped users)
  'revenue.view.all',
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.deactivate',
];

// ---------------------------------------------------------------------------
// The pure rules
// ---------------------------------------------------------------------------

describe('Customer rules', () => {
  it('formats the customer code from the sequence number', () => {
    expect(formatCustomerCode(1)).toBe('CUST-000001');
    expect(formatCustomerCode(BigInt(42))).toBe('CUST-000042');
    expect(formatCustomerCode(1234567)).toBe('CUST-1234567');
  });

  it('compares names ignoring case and surrounding or repeated space only', () => {
    expect(normalizeCustomerName('  Raj   Traders ')).toBe('raj traders');
    expect(normalizeCustomerName('RAJ TRADERS')).toBe(
      normalizeCustomerName('raj traders'),
    );
    // no fuzzy matching
    expect(normalizeCustomerName('Raj Traders Pvt Ltd')).not.toBe(
      normalizeCustomerName('Raj Traders'),
    );
  });

  it('normalises PAN and email', () => {
    expect(normalizePan(' abcde1234f ')).toBe('ABCDE1234F');
    expect(normalizeEmail(' Raj@Traders.COM ')).toBe('raj@traders.com');
  });

  it('accepts the PANs on file today and rejects malformed ones', () => {
    for (const pan of ['XYZAB1234K', 'ABCDE9999F', 'ABCDE1234F']) {
      expect(PAN_PATTERN.test(pan)).toBe(true);
    }
    for (const pan of [
      'abcde1234f',
      'ABCDE12345',
      'ABCD1234F',
      'ABCDE1234',
      '',
    ]) {
      expect(PAN_PATTERN.test(pan)).toBe(false);
    }
  });

  it('accepts the phone formats on file today and rejects junk', () => {
    for (const phone of [
      '9999999999',
      '97175 93074',
      '919888777666',
      '+91 98765-43210',
    ]) {
      expect(PHONE_PATTERN.test(phone)).toBe(true);
    }
    for (const phone of ['123', 'abcdefghij', '12-34', '+', '9'.repeat(25)]) {
      expect(PHONE_PATTERN.test(phone)).toBe(false);
    }
  });

  it('treats phones as the same when their last ten digits match', () => {
    expect(samePhone('+91 98765 43210', '9876543210')).toBe(true);
    expect(samePhone('9876543210', '9876543211')).toBe(false);
    expect(samePhone('12345', '12345')).toBe(false);
  });

  it('diffs only the fields that are present and different', () => {
    const current = {
      customerName: 'Raj Traders',
      customerType: 'B2B',
      panNumber: 'XYZAB1234K',
      email: null,
      phone: '9999999999',
    };

    expect(diffCustomerFields(current, {})).toEqual({});
    expect(
      diffCustomerFields(current, {
        customerName: 'Raj Traders',
        phone: undefined,
      }),
    ).toEqual({});
    expect(
      diffCustomerFields(current, {
        customerName: 'Raj Traders Pvt Ltd',
        email: 'raj@traders.com',
        panNumber: null,
      }),
    ).toEqual({
      customerName: { from: 'Raj Traders', to: 'Raj Traders Pvt Ltd' },
      email: { from: null, to: 'raj@traders.com' },
      panNumber: { from: 'XYZAB1234K', to: null },
    });
  });

  it('recognises a Prisma unique violation by field or index name', () => {
    expect(
      isUniqueViolation(
        { code: 'P2002', meta: { target: ['customerCode'] } },
        'customerCode',
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        {
          code: 'P2002',
          meta: { target: 'Customer_panNumber_normalized_key' },
        },
        'panNumber',
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        { code: 'P2002', meta: { target: ['customerCode'] } },
        'panNumber',
      ),
    ).toBe(false);
    expect(isUniqueViolation(new Error('x'), 'panNumber')).toBe(false);
    expect(isUniqueViolation(null, 'panNumber')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A small fake database. The raw statements are recognised by the comment each
// one starts with. What they do in SQL is proved against a real Postgres in the
// integration run, not here.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeDb() {
  const state: {
    customers: Row[];
    events: Row[];
    gst: Row[];
    users: Row[];
    seq: number;
    nameLocks: string[];
    eventFailure: boolean;
    failCodeOnce: boolean;
    failPanOnce: boolean;
    betweenLockAndWrite: (() => void) | null;
  } = {
    customers: [],
    events: [],
    gst: [],
    users: [
      { id: USER, fullName: 'Asha Admin' },
      { id: 'user-2', fullName: 'Ravi Reviewer' },
    ],
    seq: 0,
    nameLocks: [],
    eventFailure: false,
    failCodeOnce: false,
    failPanOnce: false,
    betweenLockAndWrite: null,
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

  const withInclude = (row: Row | undefined, include?: Row) => {
    if (!row) return null;
    const out = { ...row };
    if (include?.gstRegistrations) {
      out.gstRegistrations = state.gst
        .filter((g) => g.customerId === row.id)
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
    }
    if (include?.deactivatedBy) {
      out.deactivatedBy = row.deactivatedById
        ? pick(
            state.users.find((u) => u.id === row.deactivatedById),
            include.deactivatedBy.select,
          )
        : null;
    }
    return out;
  };

  const panKey = (pan: string | null) =>
    pan && pan.trim() !== '' ? pan.trim().toUpperCase() : null;

  const panTaken = (pan: string | null, exceptId?: string) =>
    panKey(pan) !== null &&
    state.customers.some(
      (c) => c.id !== exceptId && panKey(c.panNumber) === panKey(pan),
    );

  const p2002 = (target: unknown) =>
    Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target },
    });

  let rowCounter = 1000;

  const db: any = {
    // The values are in the order the placeholders appear in each statement.
    $queryRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
      const sql = strings.join('?');

      if (sql.includes('customer:lock')) {
        const c = state.customers.find((x) => x.id === v[0]);
        return c ? [{ isActive: c.isActive }] : [];
      }

      if (sql.includes('customer:next-code')) {
        state.seq += 1;
        return [{ n: String(state.seq) }];
      }

      if (sql.includes('customer:matches')) {
        // gstin x2, pan x3, name x2, phone x3, email x2, exclude x2
        const [gstin, , pan, , , name, , phone, , , email, , exclude] = v;
        return state.customers
          .filter((c) => c.id !== exclude)
          .map((c) => ({
            id: c.id,
            customerCode: c.customerCode,
            customerName: c.customerName,
            isActive: c.isActive,
            // registrations are not modelled here: a GSTIN matches nothing
            gstinMatch: gstin !== null && false,
            panMatch:
              pan !== null &&
              panKey(c.panNumber) !== null &&
              panKey(c.panNumber) === panKey(pan),
            nameMatch:
              name !== null &&
              normalizeCustomerName(c.customerName) ===
                normalizeCustomerName(name),
            phoneMatch:
              phone !== null && c.phone != null && samePhone(c.phone, phone),
            emailMatch:
              email !== null &&
              c.email != null &&
              normalizeEmail(c.email) === normalizeEmail(email),
          }))
          .filter(
            (m) => m.panMatch || m.nameMatch || m.phoneMatch || m.emailMatch,
          )
          .sort(
            (a, b) =>
              Number(b.panMatch) - Number(a.panMatch) ||
              Number(b.nameMatch) - Number(a.nameMatch) ||
              a.customerCode.localeCompare(b.customerCode),
          );
      }

      throw new Error(`unexpected raw query: ${sql}`);
    },
    $executeRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
      if (strings.join('?').includes('customer:name-lock')) {
        state.nameLocks.push(v[0]);
        return 1;
      }
      throw new Error('unexpected raw statement');
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = JSON.stringify({
        c: state.customers,
        e: state.events,
      });
      try {
        return await fn(db);
      } catch (e) {
        const s = JSON.parse(snapshot);
        state.customers = s.c.map((c: Row) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
          deactivatedAt: c.deactivatedAt ? new Date(c.deactivatedAt) : null,
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
    // Who looks after a matching customer (customer-relationship.ts): no opportunities here.
    opportunity: { findMany: async () => [] },
    customer: {
      findUnique: async ({ where, select, include }: any) => {
        const row = state.customers.find((c) => c.id === where.id);
        return select ? pick(row, select) : withInclude(row, include);
      },
      findUniqueOrThrow: async ({ where, select, include }: any) => {
        const row = state.customers.find((c) => c.id === where.id);
        if (!row) throw new Error('not found');
        return select ? pick(row, select) : withInclude(row, include);
      },
      findMany: async ({ include }: any) =>
        state.customers.map((c) => withInclude(c, include)),
      create: async ({ data, include }: any) => {
        if (state.failCodeOnce) {
          state.failCodeOnce = false;
          throw p2002(['customerCode']);
        }
        if (state.failPanOnce) {
          state.failPanOnce = false;
          throw p2002('Customer_panNumber_normalized_key');
        }
        if (state.customers.some((c) => c.customerCode === data.customerCode)) {
          throw p2002(['customerCode']);
        }
        if (panTaken(data.panNumber ?? null)) {
          throw p2002('Customer_panNumber_normalized_key');
        }
        const now = new Date();
        const row: Row = {
          id: uid((rowCounter += 1)),
          customerCode: data.customerCode,
          customerName: data.customerName,
          customerType: data.customerType ?? null,
          panNumber: data.panNumber ?? null,
          email: data.email ?? null,
          phone: data.phone ?? null,
          isActive: true,
          isVendor: false,
          linkedVendorId: null,
          deactivatedAt: null,
          deactivatedById: null,
          deactivationReason: null,
          createdAt: now,
          updatedAt: now,
        };
        state.customers.push(row);
        return withInclude(row, include);
      },
      update: async ({ where, data, include }: any) => {
        const row = state.customers.find((c) => c.id === where.id);
        if (!row) throw new Error('not found');
        if ('panNumber' in data && panTaken(data.panNumber, row.id)) {
          throw p2002('Customer_panNumber_normalized_key');
        }
        Object.assign(row, data, { updatedAt: new Date() });
        return withInclude(row, include);
      },
      updateMany: async ({ where, data }: any) => {
        state.betweenLockAndWrite?.();
        const rows = state.customers.filter(
          (c) =>
            c.id === where.id &&
            (where.isActive === undefined || c.isActive === where.isActive),
        );
        rows.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
        return { count: rows.length };
      },
    },
    customerGSTRegistration: {
      findMany: async ({ where }: any) =>
        state.gst.filter(
          (g) =>
            g.customerId === where.customerId &&
            (where.isActive === undefined || g.isActive === where.isActive),
        ),
    },
    customerEvent: {
      create: async ({ data }: any) => {
        if (state.eventFailure) throw new Error('event failed');
        const row = {
          id: uid((rowCounter += 1)),
          createdAt: new Date(),
          ...data,
        };
        state.events.push(row);
        return row;
      },
      findMany: async ({ where }: any) =>
        state.events
          .filter((e) => e.customerId === where.customerId)
          .sort(
            (a, b) =>
              +new Date(b.occurredAt) - +new Date(a.occurredAt) ||
              +new Date(b.createdAt) - +new Date(a.createdAt) ||
              String(b.id).localeCompare(String(a.id)),
          )
          .map((e) => ({
            ...e,
            actor: pick(
              state.users.find((u) => u.id === e.actorId),
              { id: true, fullName: true },
            ),
          })),
    },
  };

  return { db, state };
}

const customer = (over: Row = {}): Row => ({
  id: uid(1),
  customerCode: 'CUST001',
  customerName: 'Raj Traders',
  customerType: 'B2B',
  panNumber: 'XYZAB1234K',
  email: 'raj@traders.com',
  phone: '9999999999',
  isActive: true,
  isVendor: false,
  linkedVendorId: null,
  deactivatedAt: null,
  deactivatedById: null,
  deactivationReason: null,
  createdAt: new Date('2026-06-30T05:17:15Z'),
  updatedAt: new Date('2026-06-30T05:17:15Z'),
  ...over,
});

// ---------------------------------------------------------------------------
// Over HTTP
// ---------------------------------------------------------------------------

describe('Customer master over HTTP', () => {
  let app: INestApplication;
  let ctx: ReturnType<typeof makeDb>;
  let permissions: string[];
  let userId: string | undefined;

  const build = async (withRealGuard: boolean) => {
    const mod = await Test.createTestingModule({
      controllers: [CustomerMasterController],
      providers: [
        CustomerMasterService,
        { provide: CustomerOverviewService, useValue: {} },
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
    permissions = ALL_PERMISSIONS;
    userId = USER;
    app = await build(false);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const A = uid(1);
  const B = uid(2);

  describe('permissions', () => {
    it('declares exactly one permission on every route', () => {
      const proto = CustomerMasterController.prototype as any;
      const meta = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);

      expect(meta('create')).toEqual(['customers.create']);
      expect(meta('findAll')).toEqual(['customers.view']);
      expect(meta('duplicateCheck')).toEqual(['customers.view']);
      expect(meta('findOne')).toEqual(['customers.view']);
      expect(meta('findEvents')).toEqual(['customers.view']);
      expect(meta('update')).toEqual(['customers.edit']);
      expect(meta('deactivate')).toEqual(['customers.deactivate']);
      expect(meta('reactivate')).toEqual(['customers.deactivate']);
    });

    it('is enforced per action by the real PermissionsGuard', async () => {
      const guarded = await build(true);
      ctx.state.customers.push(customer());
      const h = () => request(guarded.getHttpServer());

      permissions = ['customers.view'];
      await h().get('/customers').expect(200);
      await h().get(`/customers/${A}`).expect(200);
      await h().get(`/customers/${A}/events`).expect(200);
      await h().get('/customers/duplicate-check?customerName=x').expect(200);
      await h().post('/customers').send({ customerName: 'X' }).expect(403);
      await h()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(403);
      await h()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(403);
      await h().patch(`/customers/${A}/reactivate`).send({}).expect(403);

      permissions = ['customers.create'];
      await h().get('/customers').expect(403);
      await h().post('/customers').send({ customerName: 'X Corp' }).expect(201);

      permissions = ['customers.edit'];
      await h()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(200);
      await h()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(403);

      permissions = ['customers.deactivate'];
      await h()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      await h().patch(`/customers/${A}/reactivate`).send({}).expect(200);

      permissions = [];
      await h().get('/customers').expect(403);
      await guarded.close();
    });
  });

  describe('create', () => {
    it('assigns the code, starts active, and records who created it', async () => {
      const res = await http()
        .post('/customers')
        .send({ customerName: 'Acme Industries' })
        .expect(201);

      expect(res.body).toMatchObject({
        customerCode: 'CUST-000001',
        customerName: 'Acme Industries',
        isActive: true,
        isVendor: false,
        gstRegistrations: [],
      });
      expect(ctx.state.events).toHaveLength(1);
      expect(ctx.state.events[0]).toMatchObject({
        customerId: res.body.id,
        action: 'CUSTOMER_CREATED',
        fromStatus: undefined,
        toStatus: 'ACTIVE',
        actorId: USER,
      });
    });

    it('gives each new customer the next number and leaves existing codes alone', async () => {
      ctx.state.customers.push(
        customer({
          id: B,
          customerCode: 'CUST-1782807341928',
          customerName: 'ABC',
          panNumber: null,
        }),
      );
      ctx.state.customers.push(customer());

      const one = await http()
        .post('/customers')
        .send({ customerName: 'One Ltd' })
        .expect(201);
      const two = await http()
        .post('/customers')
        .send({ customerName: 'Two Ltd' })
        .expect(201);

      expect([one.body.customerCode, two.body.customerCode]).toEqual([
        'CUST-000001',
        'CUST-000002',
      ]);
      expect(
        ctx.state.customers.map((c) => c.customerCode).slice(0, 2),
      ).toEqual(['CUST-1782807341928', 'CUST001']);
    });

    it('normalises what it stores', async () => {
      const res = await http()
        .post('/customers')
        .send({
          customerName: '  Acme   Industries  ',
          customerType: ' B2B ',
          panNumber: ' abcde1234f ',
          email: ' Sales@Acme.COM ',
          phone: ' 98765 43210 ',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        customerName: 'Acme   Industries',
        customerType: 'B2B',
        panNumber: 'ABCDE1234F',
        email: 'sales@acme.com',
        phone: '98765 43210',
      });
    });

    it('treats blank optional fields as not supplied', async () => {
      const res = await http()
        .post('/customers')
        .send({
          customerName: 'Acme',
          panNumber: '',
          email: ' ',
          phone: '',
          customerType: '',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        panNumber: null,
        email: null,
        phone: null,
        customerType: null,
      });
    });

    it.each([
      ['no body', {}],
      ['a blank name', { customerName: '   ' }],
      ['a too long name', { customerName: 'x'.repeat(201) }],
      ['a malformed PAN', { customerName: 'A', panNumber: 'ABC123' }],
      ['a malformed email', { customerName: 'A', email: 'not-an-email' }],
      ['a malformed phone', { customerName: 'A', phone: '12' }],
      ['a too long type', { customerName: 'A', customerType: 'x'.repeat(51) }],
      ['a client supplied code', { customerName: 'A', customerCode: 'CUST-9' }],
      ['an active flag', { customerName: 'A', isActive: false }],
      ['a vendor flag', { customerName: 'A', isVendor: true }],
      ['a vendor link', { customerName: 'A', linkedVendorId: uid(9) }],
      ['an unknown field', { customerName: 'A', industry: 'x' }],
    ])('refuses %s', async (_label, body) => {
      await http().post('/customers').send(body).expect(400);
      expect(ctx.state.customers).toHaveLength(0);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('refuses a second customer with the same PAN, whatever its case or name', async () => {
      ctx.state.customers.push(customer());

      const res = await http()
        .post('/customers')
        .send({ customerName: 'Another Name', panNumber: 'xyzab1234k' })
        .expect(409);

      expect(res.body).toMatchObject({
        code: 'DUPLICATE_PAN',
        existing: {
          id: A,
          customerCode: 'CUST001',
          customerName: 'Raj Traders',
        },
      });
      expect(res.body.message).toMatch(/GST registration/);
      expect(ctx.state.customers).toHaveLength(1);
    });

    it('refuses a second customer with the same name, ignoring case and spacing', async () => {
      ctx.state.customers.push(customer());

      const res = await http()
        .post('/customers')
        .send({ customerName: '  RAJ   traders ' })
        .expect(409);

      expect(res.body).toMatchObject({
        code: 'DUPLICATE_NAME',
        existing: { id: A },
      });
      expect(ctx.state.customers).toHaveLength(1);
    });

    it('also refuses the name of an inactive customer', async () => {
      ctx.state.customers.push(customer({ isActive: false }));
      await http()
        .post('/customers')
        .send({ customerName: 'Raj Traders' })
        .expect(409);
    });

    it('reports the PAN, the stronger identity, when both match', async () => {
      ctx.state.customers.push(customer());
      const res = await http()
        .post('/customers')
        .send({ customerName: 'Raj Traders', panNumber: 'XYZAB1234K' })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE_PAN');
    });

    it('does not mistake a longer or different name for a duplicate (no fuzzy matching)', async () => {
      ctx.state.customers.push(customer());
      await http()
        .post('/customers')
        .send({ customerName: 'Raj Traders Pvt Ltd' })
        .expect(201);
    });

    it('allows the same phone or email (only warned about)', async () => {
      ctx.state.customers.push(customer());
      await http()
        .post('/customers')
        .send({
          customerName: 'Other Co',
          phone: '99999 99999',
          email: 'RAJ@traders.com',
        })
        .expect(201);
    });

    it('serialises creations of the same name with a name lock', async () => {
      await http()
        .post('/customers')
        .send({ customerName: 'Acme  Co' })
        .expect(201);
      expect(ctx.state.nameLocks).toEqual(['Acme  Co']);
    });

    it('retries with the next number when a code clashes', async () => {
      ctx.state.failCodeOnce = true;
      const res = await http()
        .post('/customers')
        .send({ customerName: 'Acme' })
        .expect(201);
      expect(res.body.customerCode).toBe('CUST-000002');
      expect(ctx.state.seq).toBe(2);
    });

    it('turns a PAN that the database refuses (a race) into a PAN conflict', async () => {
      ctx.state.failPanOnce = true;
      const res = await http()
        .post('/customers')
        .send({ customerName: 'Acme', panNumber: 'ABCDE1234F' })
        .expect(409);
      expect(res.body.code).toBe('DUPLICATE_PAN');
    });

    it('creates nothing when its event cannot be recorded', async () => {
      ctx.state.eventFailure = true;
      await http()
        .post('/customers')
        .send({ customerName: 'Acme' })
        .expect(500);
      expect(ctx.state.customers).toHaveLength(0);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('needs a signed-in user that exists', async () => {
      userId = undefined;
      await http().post('/customers').send({ customerName: 'A' }).expect(401);
      userId = 'ghost';
      await http().post('/customers').send({ customerName: 'A' }).expect(401);
      expect(ctx.state.customers).toHaveLength(0);
    });
  });

  describe('read', () => {
    it('lists every customer with its registrations, active or not, including vendor-made ones', async () => {
      ctx.state.customers.push(customer());
      ctx.state.customers.push(
        customer({
          id: B,
          customerCode: 'CUST-1782807341928',
          customerName: 'ABC Industrial Suppliers',
          panNumber: 'ABCDE9999F',
          linkedVendorId: uid(77),
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedById: USER,
          deactivationReason: 'Closed',
        }),
      );
      ctx.state.gst.push({
        id: 'g1',
        customerId: A,
        gstin: '24XYZAB1234K1Z1',
        isDefault: true,
      });

      const res = await http().get('/customers').expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].gstRegistrations).toHaveLength(1);
      expect(res.body[1]).toMatchObject({
        isActive: false,
        deactivationReason: 'Closed',
        deactivatedBy: { id: USER, fullName: 'Asha Admin' },
        linkedVendorId: uid(77),
      });
    });

    it('returns one customer, or 404', async () => {
      ctx.state.customers.push(customer());
      const res = await http().get(`/customers/${A}`).expect(200);
      expect(res.body).toMatchObject({ id: A, customerCode: 'CUST001' });
      await http()
        .get(`/customers/${uid(404)}`)
        .expect(404);
      await http()
        .get(`/customers/${uid(404)}/events`)
        .expect(404);
    });

    it('lists events newest first with the actor', async () => {
      ctx.state.customers.push(customer());
      await http()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(200);
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'Closed' })
        .expect(200);

      userId = 'user-2';
      await http().patch(`/customers/${A}/reactivate`).send({}).expect(200);

      const res = await http().get(`/customers/${A}/events`).expect(200);
      expect(res.body.map((e: any) => e.action)).toEqual([
        'CUSTOMER_REACTIVATED',
        'CUSTOMER_DEACTIVATED',
        'CUSTOMER_UPDATED',
      ]);
      expect(res.body[0].actor).toEqual({
        id: 'user-2',
        fullName: 'Ravi Reviewer',
      });
      expect(res.body[1].actor).toEqual({ id: USER, fullName: 'Asha Admin' });
    });
  });

  describe('duplicate check', () => {
    beforeEach(() => {
      ctx.state.customers.push(customer());
      ctx.state.customers.push(
        customer({
          id: B,
          customerCode: 'CUST-000002',
          customerName: 'Beta Industries',
          panNumber: 'ABCDE9999F',
          email: 'beta@example.com',
          phone: '+91 98765 43210',
        }),
      );
    });

    it('separates what would be refused from what only warrants a warning', async () => {
      const res = await http()
        .get('/customers/duplicate-check')
        .query({
          customerName: 'raj traders',
          phone: '9876543210',
          email: 'BETA@example.com',
        })
        .expect(200);

      expect(res.body.blocking).toEqual([
        {
          id: A,
          customerCode: 'CUST001',
          customerName: 'Raj Traders',
          isActive: true,
          reasons: ['NAME'],
          strength: 'STRONG',
          mappedTo: [],
          createdBy: null,
        },
      ]);
      expect(res.body.warnings).toEqual([
        {
          id: B,
          customerCode: 'CUST-000002',
          customerName: 'Beta Industries',
          isActive: true,
          reasons: ['PHONE', 'EMAIL'],
          strength: 'POSSIBLE',
          mappedTo: [],
          createdBy: null,
        },
      ]);
    });

    it('finds a PAN match whatever its case, and can leave one customer out', async () => {
      const found = await http()
        .get('/customers/duplicate-check')
        .query({ panNumber: 'abcde9999f' })
        .expect(200);
      expect(found.body.blocking.map((m: any) => m.id)).toEqual([B]);

      const own = await http()
        .get('/customers/duplicate-check')
        .query({ panNumber: 'ABCDE9999F', excludeCustomerId: B })
        .expect(200);
      expect(own.body).toEqual({ blocking: [], warnings: [] });
    });

    it('matches nothing for a half typed value, and refuses an empty question', async () => {
      const res = await http()
        .get('/customers/duplicate-check')
        .query({ panNumber: 'ABC', phone: '123' })
        .expect(200);
      expect(res.body).toEqual({ blocking: [], warnings: [] });

      await http().get('/customers/duplicate-check').expect(400);
      await http()
        .get('/customers/duplicate-check')
        .query({ customerName: '  ' })
        .expect(400);
    });

    it('is not read as a customer id', async () => {
      const res = await http()
        .get('/customers/duplicate-check')
        .query({ customerName: 'nobody' })
        .expect(200);
      expect(res.body).toEqual({ blocking: [], warnings: [] });
    });

    it('sends its regular expressions to the database intact', async () => {
      // In a JavaScript template literal "\s" and "\D" silently lose their
      // backslash, which once made name matching compare the letter "s".
      const seen: string[] = [];
      const rawQuery = ctx.db.$queryRaw;
      const rawExecute = ctx.db.$executeRaw;
      ctx.db.$queryRaw = async (s: TemplateStringsArray, ...v: any[]) => {
        seen.push(s.join('?'));
        return rawQuery(s, ...v);
      };
      ctx.db.$executeRaw = async (s: TemplateStringsArray, ...v: any[]) => {
        seen.push(s.join('?'));
        return rawExecute(s, ...v);
      };

      await http()
        .get('/customers/duplicate-check')
        .query({ customerName: 'x', phone: '9999999' })
        .expect(200);
      await http()
        .post('/customers')
        .send({ customerName: 'Y Co' })
        .expect(201);

      const sql = seen.join('\n');
      expect(sql).toContain("'[[:space:]]+'");
      expect(sql).toContain("'[^0-9]'");
      expect(sql).not.toMatch(/'s\+'/);
      expect(sql).not.toMatch(/'D'/);
    });

    it('writes nothing', async () => {
      await http()
        .get('/customers/duplicate-check')
        .query({ customerName: 'raj traders' })
        .expect(200);
      expect(ctx.state.events).toHaveLength(0);
      expect(ctx.state.nameLocks).toHaveLength(0);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      ctx.state.customers.push(customer());
      ctx.state.customers.push(
        customer({
          id: B,
          customerCode: 'CUST-000002',
          customerName: 'Beta Industries',
          panNumber: 'ABCDE9999F',
        }),
      );
    });

    it('writes only the fields that change and records them', async () => {
      const res = await http()
        .patch(`/customers/${A}`)
        .send({
          customerName: 'Raj Traders Pvt Ltd',
          phone: '9999999999',
          email: 'NEW@traders.com',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        customerName: 'Raj Traders Pvt Ltd',
        email: 'new@traders.com',
        phone: '9999999999',
        customerCode: 'CUST001',
      });
      expect(ctx.state.events).toHaveLength(1);
      expect(ctx.state.events[0]).toMatchObject({
        action: 'CUSTOMER_UPDATED',
        fromStatus: 'ACTIVE',
        toStatus: 'ACTIVE',
        actorId: USER,
        changes: {
          customerName: { from: 'Raj Traders', to: 'Raj Traders Pvt Ltd' },
          email: { from: 'raj@traders.com', to: 'new@traders.com' },
        },
      });
      expect(Object.keys(ctx.state.events[0].changes)).toEqual([
        'customerName',
        'email',
      ]);
    });

    it('does nothing, and records nothing, for an empty or unchanged edit', async () => {
      await http().patch(`/customers/${A}`).send({}).expect(200);
      await http()
        .patch(`/customers/${A}`)
        .send({ customerName: 'Raj Traders', panNumber: 'xyzab1234k' })
        .expect(200);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('clears an optional field sent blank or null, but never the name', async () => {
      const res = await http()
        .patch(`/customers/${A}`)
        .send({ email: '', phone: null, customerType: ' ' })
        .expect(200);

      expect(res.body).toMatchObject({
        email: null,
        phone: null,
        customerType: null,
      });
      expect(ctx.state.events[0].changes).toEqual({
        customerType: { from: 'B2B', to: null },
        email: { from: 'raj@traders.com', to: null },
        phone: { from: '9999999999', to: null },
      });

      await http()
        .patch(`/customers/${A}`)
        .send({ customerName: '  ' })
        .expect(400);
      await http()
        .patch(`/customers/${A}`)
        .send({ customerName: null })
        .expect(400);
    });

    it.each([
      ['the code', { customerCode: 'CUST-9' }],
      ['the active flag', { isActive: false }],
      ['the vendor flag', { isVendor: true }],
      ['an unknown field', { industry: 'x' }],
      ['a malformed PAN', { panNumber: 'bad' }],
      ['a malformed email', { email: 'bad' }],
      ['a malformed phone', { phone: '1' }],
    ])('refuses to set %s', async (_label, body) => {
      await http().patch(`/customers/${A}`).send(body).expect(400);
      expect(ctx.state.events).toHaveLength(0);
    });

    it('lets a customer change only the case of its own name', async () => {
      await http()
        .patch(`/customers/${A}`)
        .send({ customerName: 'RAJ TRADERS' })
        .expect(200);
      expect(ctx.state.customers[0].customerName).toBe('RAJ TRADERS');
    });

    it("refuses another customer's name, or PAN", async () => {
      const byName = await http()
        .patch(`/customers/${A}`)
        .send({ customerName: ' beta   industries' })
        .expect(409);
      expect(byName.body).toMatchObject({
        code: 'DUPLICATE_NAME',
        existing: { id: B },
      });

      const byPan = await http()
        .patch(`/customers/${A}`)
        .send({ panNumber: 'abcde9999f' })
        .expect(409);
      expect(byPan.body).toMatchObject({
        code: 'DUPLICATE_PAN',
        existing: { id: B },
      });

      expect(ctx.state.customers[0]).toMatchObject({
        customerName: 'Raj Traders',
        panNumber: 'XYZAB1234K',
      });
      expect(ctx.state.events).toHaveLength(0);
    });

    it('can clear the PAN, and can then give it to another customer', async () => {
      await http().patch(`/customers/${B}`).send({ panNumber: '' }).expect(200);
      await http()
        .patch(`/customers/${A}`)
        .send({ panNumber: 'ABCDE9999F' })
        .expect(200);
    });

    it("refuses a PAN that disagrees with the GSTIN of an active registration, but not an inactive one's", async () => {
      ctx.state.gst.push({
        id: 'g1',
        customerId: A,
        gstin: '24XYZAB1234K1Z1',
        isActive: true,
      });

      const res = await http()
        .patch(`/customers/${A}`)
        .send({ panNumber: 'ABCDE1234F' })
        .expect(409);
      expect(res.body.code).toBe('PAN_MISMATCHES_GST');
      expect(ctx.state.customers[0].panNumber).toBe('XYZAB1234K');
      expect(ctx.state.events).toHaveLength(0);

      // the same PAN in other letters of case, or clearing it, still agrees
      await http()
        .patch(`/customers/${A}`)
        .send({ panNumber: 'xyzab1234k' })
        .expect(200);
      await http().patch(`/customers/${A}`).send({ panNumber: '' }).expect(200);

      ctx.state.gst[0].isActive = false;
      await http()
        .patch(`/customers/${A}`)
        .send({ panNumber: 'ABCDE1234F' })
        .expect(200);
      expect(ctx.state.customers[0].panNumber).toBe('ABCDE1234F');
    });

    it('takes the name lock only when the name changes', async () => {
      await http()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(200);
      expect(ctx.state.nameLocks).toHaveLength(0);
      await http()
        .patch(`/customers/${A}`)
        .send({ customerName: 'Raj & Sons' })
        .expect(200);
      expect(ctx.state.nameLocks).toEqual(['Raj & Sons']);
    });

    it('refuses to edit an inactive customer', async () => {
      ctx.state.customers[0].isActive = false;
      const res = await http()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(409);
      expect(res.body.code).toBe('CUSTOMER_INACTIVE');
      expect(ctx.state.customers[0].phone).toBe('9999999999');
    });

    it('is 404 for an unknown customer, and needs a signed-in user', async () => {
      await http()
        .patch(`/customers/${uid(404)}`)
        .send({ phone: '9876543210' })
        .expect(404);
      userId = undefined;
      await http()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(401);
    });

    it('leaves the customer unchanged when its event cannot be recorded', async () => {
      ctx.state.eventFailure = true;
      await http()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(500);
      expect(ctx.state.customers[0].phone).toBe('9999999999');
    });
  });

  describe('deactivate and reactivate', () => {
    beforeEach(() => {
      ctx.state.customers.push(customer());
    });

    it('deactivates with a reason, and records who and why', async () => {
      const res = await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: '  Duplicate of CUST-000004  ' })
        .expect(200);

      expect(res.body).toMatchObject({
        isActive: false,
        deactivationReason: 'Duplicate of CUST-000004',
        deactivatedById: USER,
        deactivatedBy: { id: USER, fullName: 'Asha Admin' },
      });
      expect(res.body.deactivatedAt).toBeTruthy();
      expect(ctx.state.events[0]).toMatchObject({
        action: 'CUSTOMER_DEACTIVATED',
        fromStatus: 'ACTIVE',
        toStatus: 'INACTIVE',
        remarks: 'Duplicate of CUST-000004',
        actorId: USER,
      });
    });

    it('needs a reason', async () => {
      await http().patch(`/customers/${A}/deactivate`).send({}).expect(400);
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: '   ' })
        .expect(400);
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'x'.repeat(501) })
        .expect(400);
      expect(ctx.state.customers[0].isActive).toBe(true);
    });

    it('cannot deactivate twice, or an unknown customer', async () => {
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      const again = await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(409);
      expect(again.body.code).toBe('ALREADY_INACTIVE');
      expect(ctx.state.events).toHaveLength(1);
      await http()
        .patch(`/customers/${uid(404)}/deactivate`)
        .send({ reason: 'r' })
        .expect(404);
    });

    it('reactivates, clears the current deactivation and keeps the history', async () => {
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'Closed' })
        .expect(200);
      const res = await http()
        .patch(`/customers/${A}/reactivate`)
        .send({ remarks: ' Trading again ' })
        .expect(200);

      expect(res.body).toMatchObject({
        isActive: true,
        deactivatedAt: null,
        deactivatedById: null,
        deactivationReason: null,
        deactivatedBy: null,
      });
      expect(ctx.state.events.map((e) => e.action)).toEqual([
        'CUSTOMER_DEACTIVATED',
        'CUSTOMER_REACTIVATED',
      ]);
      expect(ctx.state.events[1]).toMatchObject({
        fromStatus: 'INACTIVE',
        toStatus: 'ACTIVE',
        remarks: 'Trading again',
      });
    });

    it('reactivates without remarks, but not an active customer', async () => {
      const active = await http()
        .patch(`/customers/${A}/reactivate`)
        .send({})
        .expect(409);
      expect(active.body.code).toBe('ALREADY_ACTIVE');

      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      await http().patch(`/customers/${A}/reactivate`).send({}).expect(200);
      expect(ctx.state.events[1].remarks).toBeUndefined();
    });

    it('can be edited again once reactivated', async () => {
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      await http()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(409);
      await http().patch(`/customers/${A}/reactivate`).send({}).expect(200);
      await http()
        .patch(`/customers/${A}`)
        .send({ phone: '9876543210' })
        .expect(200);
    });

    it('does not apply a deactivation to a customer that moved on after the lock', async () => {
      ctx.state.betweenLockAndWrite = () => {
        ctx.state.customers[0].isActive = false;
        ctx.state.betweenLockAndWrite = null;
      };
      const res = await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(409);
      expect(res.body.code).toBe('ALREADY_INACTIVE');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('does not apply a reactivation to a customer that moved on after the lock', async () => {
      ctx.state.customers[0].isActive = false;
      ctx.state.betweenLockAndWrite = () => {
        ctx.state.customers[0].isActive = true;
        ctx.state.betweenLockAndWrite = null;
      };
      const res = await http()
        .patch(`/customers/${A}/reactivate`)
        .send({})
        .expect(409);
      expect(res.body.code).toBe('ALREADY_ACTIVE');
      expect(ctx.state.events).toHaveLength(0);
    });

    it('records nothing when the event cannot be recorded', async () => {
      ctx.state.eventFailure = true;
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(500);
      expect(ctx.state.customers[0].isActive).toBe(true);
    });

    it('touches nothing but the customer: registrations stay as they are', async () => {
      ctx.state.gst.push({
        id: 'g1',
        customerId: A,
        gstin: '24XYZAB1234K1Z1',
        isDefault: true,
        isActive: true,
      });
      await http()
        .patch(`/customers/${A}/deactivate`)
        .send({ reason: 'r' })
        .expect(200);
      expect(ctx.state.gst).toEqual([
        {
          id: 'g1',
          customerId: A,
          gstin: '24XYZAB1234K1Z1',
          isDefault: true,
          isActive: true,
        },
      ]);
    });
  });
});
