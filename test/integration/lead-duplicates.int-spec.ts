/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- supertest response bodies are loosely typed */
import { Ctx, lead, reset, role, startApp, stopApp, user } from './harness';

// Likely duplicate leads and existing customers, on a real database.

let ctx: Ctx;
let admin: string,
  sam: string,
  tara: string,
  indiamart: string,
  website: string;
let first: string, second: string;

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', [
    'leads.view',
    'customers.view',
    'revenue.view.all',
  ]);
  const s = await role(ctx.db, 'SALES', ['leads.view', 'customers.view']);
  admin = (await user(ctx.db, 'Admin Six', a.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', s.id)).id;
  tara = (await user(ctx.db, 'Tara Sales', s.id)).id;
  indiamart = (await ctx.db.leadSource.create({ data: { name: 'IndiaMART' } }))
    .id;
  website = (await ctx.db.leadSource.create({ data: { name: 'Website' } })).id;
  // The same enquiry reported twice, a day apart, from two sources.
  first = (
    await lead(ctx.db, {
      customerName: 'Asha Rao',
      companyName: 'Sterling Pumps',
      phone: '+91 98765 43210',
      email: 'Asha@Sterling.example',
      sourceId: indiamart,
      country: 'IN',
      state: 'Maharashtra',
      city: 'Pune',
      createdAt: new Date('2026-10-01T05:00:00Z'),
      assignedToId: sam,
    })
  ).id;
  second = (
    await lead(ctx.db, {
      customerName: 'Asha  rao',
      companyName: 'sterling pumps',
      phone: '098765-43210',
      sourceId: website,
      createdAt: new Date('2026-10-02T05:00:00Z'),
      assignedToId: tara,
    })
  ).id;
  await lead(ctx.db, {
    customerName: 'Someone Else',
    companyName: 'Sterling Pumps',
    phone: '9000000001',
    country: 'IN',
    state: 'Maharashtra',
    city: 'Pune',
    sourceId: website,
  });
  await ctx.db.customer.create({
    data: {
      customerCode: 'CUST-000001',
      customerName: 'Sterling Pumps',
      phone: '9876543210',
    },
  });
});

const check = (as: string, q: Record<string, string>) =>
  ctx.as(as).get(`/leads/duplicate-check?${new URLSearchParams(q).toString()}`);

describe('while a lead is being entered', () => {
  it('finds the same number however it is written, with where and when it came from', async () => {
    const r = await check(admin, {
      phone: '(+91) 98765-43210',
      customerName: 'New Person',
    });
    expect(r.status).toBe(200);
    expect(r.body.exact).toBe(2);
    expect(
      r.body.leads.map((l: any) => [l.id, l.strength, l.reasons, l.sourceName]),
    ).toEqual([
      [first, 'EXACT', ['PHONE'], 'IndiaMART'],
      [second, 'EXACT', ['PHONE'], 'Website'],
    ]);
    expect(r.body.productComparison).toBe('unavailable');
    expect(r.body.customers).toEqual([
      {
        id: expect.any(String),
        customerCode: 'CUST-000001',
        customerName: 'Sterling Pumps',
        isActive: true,
        reasons: ['PHONE'],
      },
    ]);
  });

  it('tells an exact match (email) from a possible one (same company in the same city)', async () => {
    const r = await check(admin, {
      email: 'asha@sterling.example',
      companyName: 'Sterling Pumps',
      city: 'pune',
    });
    const by = Object.fromEntries(
      r.body.leads.map((l: any) => [l.customerName, l]),
    );
    expect(by['Asha Rao']).toMatchObject({
      strength: 'EXACT',
      reasons: ['EMAIL', 'COMPANY_AND_CITY'],
    });
    expect(by['Someone Else']).toMatchObject({
      strength: 'POSSIBLE',
      reasons: ['COMPANY_AND_CITY'],
    });
  });

  it('matches nothing on a partial number', async () => {
    expect((await check(admin, { phone: '98765' })).body.leads).toEqual([]);
  });
});

describe('for an existing lead', () => {
  it('lists the others, marks which came earlier or later, and leaves itself out', async () => {
    const r = await ctx.as(admin).get(`/leads/${second}/duplicates`);
    expect(r.status).toBe(200);
    const mine = r.body.leads.find((l: any) => l.id === first);
    expect(mine).toMatchObject({
      relation: 'EARLIER',
      strength: 'EXACT',
      reasons: ['PHONE', 'NAME_AND_COMPANY'],
      sourceName: 'IndiaMART',
    });
    expect(r.body.leads.some((l: any) => l.id === second)).toBe(false);
    const back = await ctx.as(admin).get(`/leads/${first}/duplicates`);
    expect(back.body.leads.find((l: any) => l.id === second)).toMatchObject({
      relation: 'LATER',
    });
  });
});

describe('without access to the other records', () => {
  it('says that a match exists, not which lead or customer it is', async () => {
    const r = await ctx.as(tara).get(`/leads/${second}/duplicates`);
    expect(r.status).toBe(200);
    expect(r.body.leads[0]).toEqual({
      hidden: true,
      strength: 'EXACT',
      reasons: ['PHONE', 'NAME_AND_COMPANY'],
    });
    expect(JSON.stringify(r.body)).not.toMatch(
      new RegExp(`${first}|IndiaMART|CUST-000001|2026-10-01`),
    );
    expect(r.body.customers).toEqual([
      { hidden: true, reasons: ['COMPANY_NAME', 'PHONE'] },
    ]);
    // and Sam's lead stays out of reach
    expect((await ctx.as(tara).get(`/leads/${first}/duplicates`)).status).toBe(
      404,
    );
  });

  it('writes nothing', async () => {
    const before = await ctx.db.leadTimeline.count();
    await check(sam, { phone: '9876543210' });
    await ctx.as(sam).get(`/leads/${first}/duplicates`);
    expect(await ctx.db.leadTimeline.count()).toBe(before);
    expect(await ctx.db.lead.count()).toBe(3);
  });
});
