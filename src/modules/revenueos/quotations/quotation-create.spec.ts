/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { QuotationsController } from './quotations.controller';
import { QuotationsService } from './quotations.service';

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const USER = 'user-1';
const OPP = uid(1);
const RAJ = uid(10);
const OTHER = uid(11);
const ITEM = uid(20);
const SELLER = uid(30);
const BUYER = uid(40);
const BUYER_OTHER = uid(41);

type Row = Record<string, any>;

function makeDb() {
  const state: {
    opportunities: Row[];
    customers: Row[];
    items: Row[];
    sellers: Row[];
    buyers: Row[];
    quotations: Row[];
    events: Row[];
    locks: string[];
    eventFailure: boolean;
  } = {
    opportunities: [{ id: OPP, customerId: RAJ }],
    customers: [
      { id: RAJ, isActive: true },
      { id: OTHER, isActive: true },
    ],
    items: [{ id: ITEM, hsnMaster: { gstRate: 18 } }],
    sellers: [{ id: SELLER, stateCode: '24', isActive: true }],
    buyers: [
      {
        id: BUYER,
        customerId: RAJ,
        stateCode: '27',
        stateName: 'Maharashtra',
        isActive: true,
      },
      {
        id: BUYER_OTHER,
        customerId: OTHER,
        stateCode: '24',
        stateName: 'Gujarat',
        isActive: true,
      },
    ],
    quotations: [],
    events: [],
    locks: [],
    eventFailure: false,
  };

  const db: any = {
    $queryRaw: async (strings: TemplateStringsArray, ...v: any[]) => {
      const sql = strings.join('?');

      if (sql.includes('opportunity:lock-shared')) {
        state.locks.push('opportunity');
        const o = state.opportunities.find((x) => x.id === v[0]);
        return o ? [{ customerId: o.customerId }] : [];
      }
      if (sql.includes('customer:lock-shared')) {
        state.locks.push('customer');
        const c = state.customers.find((x) => x.id === v[0]);
        return c ? [{ isActive: c.isActive }] : [];
      }
      throw new Error(`unexpected raw query: ${sql}`);
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = JSON.stringify({
        q: state.quotations,
        e: state.events,
      });
      try {
        return await fn(db);
      } catch (e) {
        const s = JSON.parse(snapshot);
        state.quotations = s.q;
        state.events = s.e;
        throw e;
      }
    },
    user: {
      findUnique: async ({ where }: any) =>
        where.id === USER ? { id: USER } : null,
    },
    inventoryItem: {
      findUnique: async ({ where }: any) =>
        state.items.find((i) => i.id === where.id) ?? null,
    },
    companyGSTRegistration: {
      findUnique: async ({ where }: any) =>
        state.sellers.find((s) => s.id === where.id) ?? null,
    },
    customerGSTRegistration: {
      findUnique: async ({ where }: any) =>
        state.buyers.find((b) => b.id === where.id) ?? null,
    },
    quotation: {
      create: async ({ data }: any) => {
        const row = {
          id: uid(900 + state.quotations.length),
          createdAt: new Date(),
          ...data,
        };
        state.quotations.push(row);
        return { ...row };
      },
    },
    quotationEvent: {
      create: async ({ data }: any) => {
        if (state.eventFailure) throw new Error('event failed');
        state.events.push(data);
        return data;
      },
    },
  };

  return { db, state };
}

const body = (over: Row = {}): Row => ({
  opportunityId: OPP,
  quoteDate: '2026-10-08',
  inventoryItemId: ITEM,
  quantity: 10,
  unitPrice: 1000,
  sellerGstId: SELLER,
  buyerGstId: BUYER,
  ...over,
});

describe('Quotation creation over HTTP', () => {
  let app: INestApplication;
  let ctx: ReturnType<typeof makeDb>;
  let userId: string | undefined;

  beforeEach(async () => {
    ctx = makeDb();
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
          c.switchToHttp().getRequest().user = {
            id: userId,
            permissions: ['quotations.create'],
          };
          return true;
        },
      })
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

  const create = (over: Row = {}) =>
    request(app.getHttpServer()).post('/quotations').send(body(over));

  it("creates a DRAFT quotation for the opportunity's customer, with the tax worked out by the backend", async () => {
    const res = await create().expect(201);

    expect(res.body).toMatchObject({
      opportunityId: OPP,
      buyerGstId: BUYER,
      sellerGstId: SELLER,
      status: 'DRAFT',
      taxType: 'IGST',
      placeOfSupply: 'Maharashtra',
      taxableAmount: 10000,
      gstPercent: 18,
      gstAmount: 1800,
      totalAmount: 11800,
    });
    expect(ctx.state.events[0]).toMatchObject({
      action: 'QUOTATION_CREATED',
      toStatus: 'DRAFT',
      actorId: USER,
    });
  });

  it('uses CGST and SGST when buyer and seller are in the same state', async () => {
    ctx.state.buyers[0].stateCode = '24';
    const res = await create().expect(201);
    expect(res.body.taxType).toBe('CGST_SGST');
  });

  it('takes the opportunity first and then the customer, both in shared mode', async () => {
    await create().expect(201);
    expect(ctx.state.locks).toEqual(['opportunity', 'customer']);
  });

  it('needs an opportunity that has a customer', async () => {
    ctx.state.opportunities[0].customerId = null;
    const res = await create().expect(409);

    expect(res.body.code).toBe('OPPORTUNITY_NOT_LINKED');
    expect(res.body.message).toMatch(/Link a customer/);
    expect(ctx.state.quotations).toHaveLength(0);
    expect(ctx.state.locks).toEqual(['opportunity']);
  });

  it('is 404 for an unknown opportunity, item or registration', async () => {
    await create({ opportunityId: uid(404) }).expect(404);
    await create({ inventoryItemId: uid(404) }).expect(404);
    await create({ sellerGstId: uid(404) }).expect(404);
    await create({ buyerGstId: uid(404) }).expect(404);
    expect(ctx.state.quotations).toHaveLength(0);
  });

  it('refuses an item whose HSN is not mapped', async () => {
    ctx.state.items[0].hsnMaster = null;
    const res = await create().expect(400);
    expect(res.body.message).toMatch(/HSN/);
  });

  it('refuses an inactive customer', async () => {
    ctx.state.customers[0].isActive = false;
    const res = await create().expect(409);

    expect(res.body.code).toBe('CUSTOMER_INACTIVE');
    expect(ctx.state.quotations).toHaveLength(0);
  });

  it('refuses a buyer registration that belongs to another customer, however active it is', async () => {
    const res = await create({ buyerGstId: BUYER_OTHER }).expect(400);

    expect(res.body.code).toBe('BUYER_GST_NOT_CUSTOMERS');
    expect(ctx.state.quotations).toHaveLength(0);
  });

  it('refuses an inactive buyer or seller registration', async () => {
    ctx.state.buyers[0].isActive = false;
    const buyer = await create().expect(409);
    expect(buyer.body.code).toBe('GST_INACTIVE');
    expect(buyer.body.message).toMatch(/buyer/);

    ctx.state.buyers[0].isActive = true;
    ctx.state.sellers[0].isActive = false;
    const seller = await create().expect(409);
    expect(seller.body.message).toMatch(/seller/);
  });

  it('refuses a body that names a customer: the customer comes from the opportunity', async () => {
    await create({ customerId: RAJ }).expect(400);
    expect(ctx.state.quotations).toHaveLength(0);
  });

  it('needs a signed-in user that exists', async () => {
    userId = undefined;
    await create().expect(401);
    userId = 'ghost';
    await create().expect(401);
    expect(ctx.state.quotations).toHaveLength(0);
  });

  it('creates nothing when its event cannot be recorded', async () => {
    ctx.state.eventFailure = true;
    await create().expect(500);
    expect(ctx.state.quotations).toHaveLength(0);
  });
});
