/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USER = 'user-1';
const OPP = uid(1);
const LEAD = uid(2);
const RAJ = uid(10);
const ABC = uid(11);

// ---------------------------------------------------------------------------
// A small fake database. Raw statements are recognised by the comment each one
// starts with (or, for the lead lock, by its table); what they do in SQL is
// proved against a real Postgres in the integration run.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeDb() {
  const state: {
    opportunities: Row[];
    leads: Row[];
    customers: Row[];
    quotations: Row[];
    proformas: Row[];
    orders: Row[];
    registrations: Row[];
    timelines: Row[];
    events: Row[];
    users: Row[];
    eventFailure: boolean;
    betweenLockAndWrite: (() => void) | null;
  } = {
    opportunities: [],
    leads: [{ id: LEAD, isActive: true }],
    customers: [],
    quotations: [],
    proformas: [],
    orders: [],
    registrations: [],
    timelines: [],
    events: [],
    users: [{ id: USER, fullName: 'Asha Admin' }],
    eventFailure: false,
    betweenLockAndWrite: null,
  };

  const summary = (c: Row | undefined) =>
    c
      ? {
          id: c.id,
          customerCode: c.customerCode,
          customerName: c.customerName,
          isActive: c.isActive,
        }
      : null;

  const withCustomer = (o: Row | undefined, include?: Row) => {
    if (!o) return null;
    const out = { ...o };
    if (include?.customer) {
      out.customer = summary(
        state.customers.find((c) => c.id === o.customerId),
      );
    }
    return out;
  };

  let counter = 1000;

  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
      const sql = strings.join('?');

      if (sql.includes('opportunity:lock-link')) {
        const o = state.opportunities.find((x) => x.id === v[0]);
        return o ? [{ customerId: o.customerId }] : [];
      }
      if (sql.includes('customer:lock-shared')) {
        const c = state.customers.find((x) => x.id === v[0]);
        return c ? [{ isActive: c.isActive }] : [];
      }
      if (sql.includes('FROM "Lead"')) {
        const l = state.leads.find((x) => x.id === v[0]);
        return l ? [{ isActive: l.isActive }] : [];
      }
      throw new Error(`unexpected raw query: ${sql}`);
    },
    lead: {
      // Every lead here is qualified: the create gate is tested in opportunity-create-gate.spec.ts.
      findUniqueOrThrow: async ({ where }: any) => {
        const l = state.leads.find((x: any) => x.id === where.id);
        if (!l) throw new Error('lead not found');
        return { status: l.status ?? 'SALES_ASSIGNED' };
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = JSON.stringify({
        o: state.opportunities,
        t: state.timelines,
        e: state.events,
      });
      try {
        return await fn(db);
      } catch (e) {
        const s = JSON.parse(snapshot);
        state.opportunities = s.o.map((o: Row) => ({
          ...o,
          expectedCloseDate: new Date(o.expectedCloseDate),
          createdAt: new Date(o.createdAt),
        }));
        state.timelines = s.t;
        state.events = s.e;
        throw e;
      }
    },
    user: {
      findUnique: async ({ where }: any) =>
        state.users.find((u) => u.id === where.id) ?? null,
    },
    opportunity: {
      findUnique: async ({ where, select, include }: any) => {
        const o = state.opportunities.find((x) => x.id === where.id);
        if (!o) return null;
        if (select) {
          return Object.fromEntries(Object.keys(select).map((k) => [k, o[k]]));
        }
        return withCustomer(o, include);
      },
      findUniqueOrThrow: async ({ where, include }: any) => {
        const o = state.opportunities.find((x) => x.id === where.id);
        if (!o) throw new Error('not found');
        return withCustomer(o, include);
      },
      findMany: async ({ include }: any) =>
        state.opportunities.map((o) => withCustomer(o, include)),
      create: async ({ data }: any) => {
        const o = {
          id: uid((counter += 1)),
          status: data.status,
          createdAt: new Date(),
          ...data,
          customerId: data.customerId ?? null,
        };
        state.opportunities.push(o);
        return { ...o };
      },
      updateMany: async ({ where, data }: any) => {
        state.betweenLockAndWrite?.();
        const rows = state.opportunities.filter(
          (o) =>
            o.id === where.id &&
            (where.customerId === undefined ||
              o.customerId === where.customerId),
        );
        rows.forEach((r) => Object.assign(r, data));
        return { count: rows.length };
      },
    },
    quotation: {
      count: async ({ where }: any) =>
        state.quotations.filter((q) => q.opportunityId === where.opportunityId)
          .length,
      findMany: async ({ where }: any) =>
        state.quotations.filter((q) => q.opportunityId === where.opportunityId),
    },
    proformaInvoice: {
      findMany: async ({ where }: any) =>
        state.proformas.filter((p) =>
          where.quotationId.in.includes(p.quotationId),
        ),
    },
    salesOrder: {
      findMany: async ({ where }: any) =>
        state.orders.filter(
          (o) =>
            where.OR[0].quotationId.in.includes(o.quotationId) ||
            where.OR[1].proformaInvoiceId.in.includes(o.proformaInvoiceId),
        ),
    },
    customerGSTRegistration: {
      count: async ({ where }: any) =>
        state.registrations.filter(
          (r) =>
            where.id.in.includes(r.id) && r.customerId !== where.customerId.not,
        ).length,
    },
    customer: {
      findUniqueOrThrow: async ({ where }: any) => {
        const c = state.customers.find((x) => x.id === where.id);
        if (!c) throw new Error('not found');
        return { ...c };
      },
    },
    leadTimeline: {
      create: async ({ data }: any) => {
        const row = { id: uid((counter += 1)), ...data };
        state.timelines.push(row);
        return row;
      },
    },
    customerEvent: {
      create: async ({ data }: any) => {
        if (state.eventFailure) throw new Error('event failed');
        const row = { id: uid((counter += 1)), ...data };
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
  isActive: true,
  ...over,
});

const opportunity = (over: Row = {}): Row => ({
  id: OPP,
  leadId: LEAD,
  title: 'Industrial Pump Supply Deal',
  status: 'QUALIFIED',
  customerId: null,
  expectedCloseDate: new Date('2026-12-31'),
  createdAt: new Date('2026-07-01'),
  ...over,
});

describe('Opportunity customer link over HTTP', () => {
  let app: INestApplication;
  let ctx: ReturnType<typeof makeDb>;
  let permissions: string[];
  let userId: string | undefined;

  const build = async (withRealGuard: boolean) => {
    const mod = await Test.createTestingModule({
      controllers: [OpportunitiesController],
      providers: [
        OpportunitiesService,
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
    ctx.state.customers.push(
      customer({
        id: ABC,
        customerCode: 'CUST002',
        customerName: 'ABC Industrial',
      }),
    );
    ctx.state.opportunities.push(opportunity());
    permissions = [
      'opportunities.create',
      'opportunities.view',
      'opportunities.edit',
    ];
    userId = USER;
    app = await build(false);
  });

  afterEach(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const link = (customerId: unknown) =>
    http().patch(`/opportunities/${OPP}/customer`).send({ customerId });
  const eventsOf = (customerId: string) =>
    ctx.state.events.filter((e) => e.customerId === customerId);

  describe('permissions', () => {
    it('links with opportunities.edit and creates with opportunities.create', () => {
      const proto = OpportunitiesController.prototype as any;
      const meta = (name: string) =>
        Reflect.getMetadata(PERMISSIONS_KEY, proto[name]);

      expect(meta('linkCustomer')).toEqual(['opportunities.edit']);
      expect(meta('create')).toEqual(['opportunities.create']);
    });

    it('is enforced by the real PermissionsGuard', async () => {
      const guarded = await build(true);
      permissions = ['opportunities.view'];
      await request(guarded.getHttpServer())
        .patch(`/opportunities/${OPP}/customer`)
        .send({ customerId: RAJ })
        .expect(403);
      permissions = ['opportunities.edit'];
      await request(guarded.getHttpServer())
        .patch(`/opportunities/${OPP}/customer`)
        .send({ customerId: RAJ })
        .expect(200);
      await guarded.close();
    });
  });

  describe('link', () => {
    it('links a customer, and records who did it on the lead and on the customer', async () => {
      const res = await link(RAJ).expect(200);

      expect(res.body).toMatchObject({
        id: OPP,
        customerId: RAJ,
        customer: {
          id: RAJ,
          customerCode: 'CUST001',
          customerName: 'Raj Traders',
          isActive: true,
        },
      });
      expect(ctx.state.timelines).toHaveLength(1);
      expect(ctx.state.timelines[0]).toMatchObject({
        leadId: LEAD,
        action: 'OPPORTUNITY_CUSTOMER_LINKED',
        actorId: USER,
      });
      expect(ctx.state.timelines[0].remarks).toMatch(/Raj Traders \(CUST001\)/);
      expect(eventsOf(RAJ)).toHaveLength(1);
      expect(eventsOf(RAJ)[0]).toMatchObject({
        action: 'OPPORTUNITY_LINKED',
        opportunityId: OPP,
        actorId: USER,
        remarks: 'Industrial Pump Supply Deal',
      });
    });

    it('changes the customer while there is no quotation, recording both customers', async () => {
      await link(RAJ).expect(200);
      await link(ABC).expect(200);

      expect(ctx.state.opportunities[0].customerId).toBe(ABC);
      expect(ctx.state.timelines.map((t) => t.action)).toEqual([
        'OPPORTUNITY_CUSTOMER_LINKED',
        'OPPORTUNITY_CUSTOMER_CHANGED',
      ]);
      expect(ctx.state.timelines[1].remarks).toMatch(
        /Raj Traders \(CUST001\) → ABC Industrial \(CUST002\)/,
      );
      expect(eventsOf(RAJ).map((e) => e.action)).toEqual([
        'OPPORTUNITY_LINKED',
        'OPPORTUNITY_UNLINKED',
      ]);
      expect(eventsOf(ABC).map((e) => e.action)).toEqual([
        'OPPORTUNITY_LINKED',
      ]);
    });

    it('removes the customer with null', async () => {
      await link(RAJ).expect(200);
      const res = await link(null).expect(200);

      expect(res.body).toMatchObject({ customerId: null, customer: null });
      expect(ctx.state.timelines[1].action).toBe(
        'OPPORTUNITY_CUSTOMER_UNLINKED',
      );
      expect(eventsOf(RAJ).map((e) => e.action)).toEqual([
        'OPPORTUNITY_LINKED',
        'OPPORTUNITY_UNLINKED',
      ]);
    });

    it('does nothing, and records nothing, when the customer is the one already linked', async () => {
      await link(RAJ).expect(200);
      await link(RAJ).expect(200);
      expect(ctx.state.timelines).toHaveLength(1);
      expect(ctx.state.events).toHaveLength(1);

      ctx.state.opportunities[0].customerId = null;
      await link(null).expect(200);
      expect(ctx.state.timelines).toHaveLength(1);
    });

    it.each([
      ['no customerId', {}],
      ['a customerId that is not a uuid', { customerId: 'raj' }],
      ['a blank customerId', { customerId: '' }],
      ['a number', { customerId: 5 }],
      ['an unknown field', { customerId: RAJ, extra: 1 }],
    ])('refuses %s', async (_label, body) => {
      await http()
        .patch(`/opportunities/${OPP}/customer`)
        .send(body)
        .expect(400);
      expect(ctx.state.opportunities[0].customerId).toBeNull();
      expect(ctx.state.events).toHaveLength(0);
    });

    it('is 404 for an unknown opportunity or customer', async () => {
      await http()
        .patch(`/opportunities/${uid(404)}/customer`)
        .send({ customerId: RAJ })
        .expect(404);
      await link(uid(404)).expect(404);
      expect(ctx.state.opportunities[0].customerId).toBeNull();
    });

    it('refuses an inactive customer, but lets an inactive customer be unlinked', async () => {
      ctx.state.customers[1].isActive = false;
      const res = await link(ABC).expect(409);
      expect(res.body.code).toBe('CUSTOMER_INACTIVE');
      expect(ctx.state.opportunities[0].customerId).toBeNull();

      ctx.state.opportunities[0].customerId = ABC;
      await link(null).expect(200);
      expect(ctx.state.opportunities[0].customerId).toBeNull();
    });

    it('refuses an inactive lead', async () => {
      ctx.state.leads[0].isActive = false;
      await link(RAJ).expect(409);
      expect(ctx.state.opportunities[0].customerId).toBeNull();
    });

    it('is locked once it has a customer and a quotation, for a change and an unlink', async () => {
      await link(RAJ).expect(200);
      ctx.state.quotations.push({ id: uid(77), opportunityId: OPP });

      for (const target of [ABC, null]) {
        const res = await link(target).expect(409);
        expect(res.body.code).toBe('OPPORTUNITY_CUSTOMER_LOCKED');
      }
      expect(ctx.state.opportunities[0].customerId).toBe(RAJ);
      expect(ctx.state.events).toHaveLength(1);

      // linking the same customer again is still a harmless no-op
      await link(RAJ).expect(200);
    });

    describe('a legacy opportunity that already has documents', () => {
      const REG_RAJ = uid(60);
      const REG_ABC = uid(61);

      beforeEach(() => {
        ctx.state.registrations.push(
          { id: REG_RAJ, customerId: RAJ },
          { id: REG_ABC, customerId: ABC },
        );
        ctx.state.quotations.push(
          { id: uid(70), opportunityId: OPP, buyerGstId: null },
          { id: uid(71), opportunityId: OPP, buyerGstId: REG_RAJ },
        );
        ctx.state.proformas.push({ id: uid(80), quotationId: uid(71) });
        ctx.state.orders.push({
          id: uid(90),
          quotationId: null,
          proformaInvoiceId: uid(80),
          buyerGstId: REG_RAJ,
        });
      });

      it('can be given its first customer, which is how an existing deal joins the customer', async () => {
        const res = await link(RAJ).expect(200);

        expect(res.body.customerId).toBe(RAJ);
        expect(ctx.state.timelines[0].action).toBe(
          'OPPORTUNITY_CUSTOMER_LINKED',
        );
        expect(eventsOf(RAJ)).toHaveLength(1);
      });

      it('can be given a customer when none of its documents has a registration', async () => {
        ctx.state.quotations[1].buyerGstId = null;
        ctx.state.orders[0].buyerGstId = null;
        await link(ABC).expect(200);
      });

      it("cannot be given a customer whose registrations its quotations don't use", async () => {
        const res = await link(ABC).expect(409);

        expect(res.body.code).toBe('OPPORTUNITY_GST_OF_ANOTHER_CUSTOMER');
        expect(ctx.state.opportunities[0].customerId).toBeNull();
        expect(ctx.state.events).toHaveLength(0);
      });

      it('also looks at the registrations of the orders made from its quotations', async () => {
        ctx.state.quotations[1].buyerGstId = null;
        ctx.state.orders[0].buyerGstId = REG_ABC;

        const res = await link(RAJ).expect(409);
        expect(res.body.code).toBe('OPPORTUNITY_GST_OF_ANOTHER_CUSTOMER');
      });

      it('keeps the customer afterwards: it can no longer be changed or removed', async () => {
        await link(RAJ).expect(200);
        const changed = await link(ABC).expect(409);
        expect(changed.body.code).toBe('OPPORTUNITY_CUSTOMER_LOCKED');
        await link(null).expect(409);
      });
    });

    it('does not apply a link to an opportunity that changed after the lock', async () => {
      ctx.state.betweenLockAndWrite = () => {
        ctx.state.opportunities[0].customerId = ABC;
        ctx.state.betweenLockAndWrite = null;
      };
      const res = await link(RAJ).expect(409);
      expect(res.body.code).toBe('OPPORTUNITY_CUSTOMER_CHANGED');
      expect(ctx.state.events).toHaveLength(0);
      expect(ctx.state.timelines).toHaveLength(0);
    });

    it('changes nothing when its event cannot be recorded', async () => {
      ctx.state.eventFailure = true;
      await link(RAJ).expect(500);
      expect(ctx.state.opportunities[0].customerId).toBeNull();
      expect(ctx.state.timelines).toHaveLength(0);
    });

    it('needs a signed-in user that exists', async () => {
      userId = undefined;
      await link(RAJ).expect(401);
      userId = 'ghost';
      await link(RAJ).expect(401);
      expect(ctx.state.opportunities[0].customerId).toBeNull();
    });
  });

  describe('create with a customer', () => {
    const valid = {
      leadId: LEAD,
      title: 'New deal',
      expectedValue: 1000,
      probability: 50,
      expectedCloseDate: '2026-12-31',
    };

    it('can be created linked, recording who linked it', async () => {
      const res = await http()
        .post('/opportunities')
        .send({ ...valid, customerId: RAJ })
        .expect(201);

      expect(res.body).toMatchObject({
        customerId: RAJ,
        customer: { id: RAJ, customerCode: 'CUST001' },
      });
      expect(ctx.state.timelines[0]).toMatchObject({
        action: 'OPPORTUNITY_CREATED',
        actorId: USER,
      });
      expect(eventsOf(RAJ)[0]).toMatchObject({
        action: 'OPPORTUNITY_LINKED',
        opportunityId: res.body.id,
        remarks: 'New deal',
        actorId: USER,
      });
    });

    it('is created without a customer exactly as before', async () => {
      const res = await http().post('/opportunities').send(valid).expect(201);

      expect(res.body).toMatchObject({ customerId: null, customer: null });
      expect(ctx.state.events).toHaveLength(0);
      expect(ctx.state.timelines[0].actorId).toBeUndefined();
    });

    it('refuses an unknown, malformed or inactive customer', async () => {
      await http()
        .post('/opportunities')
        .send({ ...valid, customerId: 'raj' })
        .expect(400);
      await http()
        .post('/opportunities')
        .send({ ...valid, customerId: uid(404) })
        .expect(404);

      ctx.state.customers[0].isActive = false;
      const res = await http()
        .post('/opportunities')
        .send({ ...valid, customerId: RAJ })
        .expect(409);
      expect(res.body.code).toBe('CUSTOMER_INACTIVE');
      expect(ctx.state.opportunities).toHaveLength(1);
    });

    it('needs a signed-in user when it links a customer', async () => {
      userId = undefined;
      await http()
        .post('/opportunities')
        .send({ ...valid, customerId: RAJ })
        .expect(401);
      await http().post('/opportunities').send(valid).expect(201);
    });

    it('is not created when the lead is inactive or its event fails', async () => {
      ctx.state.eventFailure = true;
      await http()
        .post('/opportunities')
        .send({ ...valid, customerId: RAJ })
        .expect(500);
      expect(ctx.state.opportunities).toHaveLength(1);

      ctx.state.eventFailure = false;
      ctx.state.leads[0].isActive = false;
      await http()
        .post('/opportunities')
        .send({ ...valid, customerId: RAJ })
        .expect(409);
    });
  });

  describe('read', () => {
    it('returns the customer with every opportunity', async () => {
      await link(RAJ).expect(200);
      ctx.state.opportunities.push(opportunity({ id: uid(5), title: 'Other' }));

      const list = await http().get('/opportunities').expect(200);
      expect(list.body[0].customer).toEqual({
        id: RAJ,
        customerCode: 'CUST001',
        customerName: 'Raj Traders',
        isActive: true,
      });
      expect(list.body[1].customer).toBeNull();
    });
  });
});
