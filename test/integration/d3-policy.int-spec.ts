/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are loosely typed */
import {
  Chain,
  chain,
  Ctx,
  lead,
  reset,
  role,
  startApp,
  stopApp,
  user,
} from './harness';

// The confirmed visibility and customer-ownership policy (D3, 2026-10-17) on a real
// database, with simulated people in every role: an administrator, pre-sales, two
// salespeople, finance (with and without finance visibility) and an HR user with no
// RevenueOS access. Every check is made the way the screens make it - over HTTP with the
// person's own login - and checks both the permission code and the record scope.

let ctx: Ctx;
const PRESALES = [
  'leads.view',
  'leads.create',
  'leads.edit',
  'leads.status.update',
  'leads.qualify',
  'leads.reject',
  'leads.followups.view',
  'leads.followups.create',
  'customers.view',
];
const SALES = [
  ...PRESALES,
  'opportunities.view',
  'customers.create',
  'customers.edit',
  'customers.gst.manage',
  'quotations.view',
  'proformas.view',
  'salesorders.view',
  'invoices.view',
  'collections.view',
];
const FINANCE = [
  'invoices.view',
  'collections.view',
  'collections.record',
  'salesorders.advancereceipts.view',
];
let admin: string,
  priya: string,
  pia: string,
  sam: string,
  tara: string,
  fiona: string,
  finn: string,
  hari: string;
let samChain: Chain, taraChain: Chain, handed: string, financeRole: string;

const gst = (gstin: string) => ({
  gstin,
  legalName: 'Registered Name',
  addressLine1: '1 Mill Road',
  city: 'Pune',
  pincode: '411001',
});

beforeAll(async () => {
  ctx = await startApp();
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', [
    ...SALES,
    ...FINANCE,
    'leads.assign',
    'roles.view',
    'roles.permissions.assign',
    'revenue.view.all',
    'payments.gateway.manage',
  ]);
  const p = await role(ctx.db, 'PRE_SALES', PRESALES);
  const s = await role(ctx.db, 'SALES', SALES);
  const f = await role(ctx.db, 'FINANCE', [...FINANCE, 'finance.view.all']);
  financeRole = f.id;
  const fl = await role(ctx.db, 'FINANCE_CLERK', FINANCE);
  const h = await role(ctx.db, 'HR', ['employees.view']);
  admin = (await user(ctx.db, 'Admin Four', a.id)).id;
  priya = (await user(ctx.db, 'Priya Presales', p.id)).id;
  pia = (await user(ctx.db, 'Pia Presales', p.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', s.id)).id;
  tara = (await user(ctx.db, 'Tara Sales', s.id)).id;
  fiona = (await user(ctx.db, 'Fiona Finance', f.id)).id;
  finn = (await user(ctx.db, 'Finn Clerk', fl.id)).id;
  hari = (await user(ctx.db, 'Hari HR', h.id)).id;
  samChain = await chain(ctx.db, sam, 'Sterling Pumps', '27AAAAA1111A1Z1');
  taraChain = await chain(ctx.db, tara, 'Tara Textiles', '27BBBBB2222B1Z2');

  // Priya works a lead in pre-sales, logs a call, and hands it to Sam.
  const l = await lead(ctx.db, {
    customerName: 'Handed Over',
    phone: '9811100001',
  });
  handed = l.id;
  expect(
    (
      await ctx
        .as(admin)
        .post('/lead-assignments', { leadId: l.id, assignedToId: priya })
    ).status,
  ).toBe(201);
  expect(
    (
      await ctx.as(priya).post(`/leads/${l.id}/activities`, {
        activityType: 'CALL',
        outcome: 'NOT_CONNECTED',
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await ctx
        .as(priya)
        .patch(`/lead-assignments/${l.id}/qualify`, { salesUserId: sam })
    ).status,
  ).toBe(200);
});
afterAll(async () => stopApp(ctx));

const ids = (body: Array<{ id: string }>) => body.map((r) => r.id).sort();
const total = async (who: string, q = '') =>
  (await ctx.as(who).get(`/leads/search${q}`)).body.total as number;

describe('Super Admin', () => {
  it('sees every lead, customer, invoice, receivable and the company totals', async () => {
    expect(await total(admin)).toBe(await ctx.db.lead.count());
    expect(ids((await ctx.as(admin).get('/customers')).body)).toEqual(
      [samChain.customer, taraChain.customer].sort(),
    );
    expect(ids((await ctx.as(admin).get('/sales-invoices')).body)).toEqual(
      [samChain.invoice, taraChain.invoice].sort(),
    );
    expect((await ctx.as(admin).get('/accounts-receivable')).body).toHaveLength(
      2,
    );
    expect(
      (await ctx.as(admin).get('/collections-dashboard/summary')).status,
    ).toBe(200);
  });
});

describe('Pre-Sales', () => {
  it('keeps the lead it handed to Sales, with its whole history', async () => {
    const mine = (await ctx.as(priya).get('/leads')).body;
    expect(ids(mine)).toEqual([handed]);
    const d = await ctx.as(priya).get(`/leads/${handed}`);
    expect(d.status).toBe(200);
    const actions = d.body.timelines.map((t: any) => t.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'PRE_SALES_ASSIGNED',
        'ACTIVITY_CALL',
        'LEAD_QUALIFIED',
      ]),
    );
    expect(
      d.body.timelines.find((t: any) => t.action === 'ACTIVITY_CALL').outcome,
    ).toBe('NOT_CONNECTED');
    // Notes are a separate list from the interaction history.
    expect(Array.isArray(d.body.notes)).toBe(true);
  });

  it('does not see other leads, and gets nothing commercial without the codes', async () => {
    expect((await ctx.as(priya).get(`/leads/${samChain.lead}`)).status).toBe(
      404,
    );
    for (const url of [
      '/sales-invoices',
      '/opportunities',
      '/quotations',
      '/accounts-receivable',
    ])
      expect([url, (await ctx.as(priya).get(url)).status]).toEqual([url, 403]);
    expect(
      (await ctx.as(priya).get('/collections-dashboard/summary')).status,
    ).toBe(403);
  });

  it("is told an enquiry matches a customer Sam looks after, without the customer's details", async () => {
    const r = await ctx.as(priya).get('/leads/duplicate-check').query({
      companyName: 'Sterling Pumps',
      gstin: '27 aaaaa 1111 a1z1',
    });
    expect(r.status).toBe(200);
    expect(r.body.customers).toEqual([
      expect.objectContaining({
        hidden: true,
        link: 'MATCH',
        strength: 'EXACT',
        reasons: expect.arrayContaining(['GSTIN']),
        mappedTo: [{ id: sam, fullName: 'Sam Sales' }],
      }),
    ]);
    const raw = JSON.stringify(r.body);
    expect(raw).not.toContain(samChain.customer);
    expect(raw).not.toContain('CUST-');
  });

  it('reassignment keeps the earlier pre-sales person in sight (historical participation)', async () => {
    const l = await lead(ctx.db, { customerName: 'Moved Around' });
    await ctx
      .as(admin)
      .post('/lead-assignments', { leadId: l.id, assignedToId: priya });
    expect(
      (
        await ctx
          .as(admin)
          .post('/lead-assignments', { leadId: l.id, assignedToId: pia })
      ).status,
    ).toBe(201);
    expect((await ctx.as(pia).get(`/leads/${l.id}`)).status).toBe(200);
    expect((await ctx.as(priya).get(`/leads/${l.id}`)).status).toBe(200);
    expect((await ctx.as(tara).get(`/leads/${l.id}`)).status).toBe(404);
  });
});

describe('Sales', () => {
  it("sees only their leads, filtered by lifecycle status, never another salesperson's", async () => {
    await ctx.db.lead.update({
      where: { id: samChain.lead },
      data: { status: 'WON' },
    });
    expect(await total(sam, '?status=WON')).toBe(1);
    expect(await total(sam, '?status=NEW,CONTACTED,UNDERQUALIFIED')).toBe(0);
    expect(await total(sam, '?status=SALES_ASSIGNED,QUALIFIED')).toBe(1); // the handed lead
    expect(await total(tara, '?status=WON')).toBe(0);
    // stages group the canonical statuses
    expect(await total(sam, '?stage=WON')).toBe(1);
    expect(await total(sam, '?stage=QUALIFIED')).toBe(1);
    expect(
      await total(sam, '?stage=PRE_QUALIFICATION,IN_PROGRESS,LOST,REJECTED'),
    ).toBe(0);
    const f = (await ctx.as(sam).get('/leads/search')).body.facets.stage;
    expect(f).toEqual(
      expect.arrayContaining([
        { value: 'WON', count: 1 },
        { value: 'QUALIFIED', count: 1 },
      ]),
    );
    expect((await ctx.as(sam).get('/leads/search?stage=BOGUS')).status).toBe(
      400,
    );
    await ctx.db.lead.update({
      where: { id: samChain.lead },
      data: { status: 'SALES_ASSIGNED' },
    });
  });

  it("cannot browse another salesperson's customers, statements or receivables", async () => {
    expect(ids((await ctx.as(sam).get('/customers')).body)).toEqual([
      samChain.customer,
    ]);
    for (const url of [
      `/customers/${taraChain.customer}`,
      `/customers/${taraChain.customer}/overview`,
      `/customers/${taraChain.customer}/statement`,
      `/customers/${taraChain.customer}/statement.pdf`,
    ])
      expect([url, (await ctx.as(sam).get(url)).status]).toEqual([url, 404]);
    const ar = (await ctx.as(sam).get('/accounts-receivable')).body;
    expect(ar.map((r: any) => r.salesInvoiceId)).toEqual([samChain.invoice]);
  });

  it('company-wide finance, ledgers, dashboards and gateway settings are refused', async () => {
    for (const url of [
      '/collections-dashboard/summary',
      '/collections-dashboard/customer-ranking',
      '/customer-ledgers',
      '/customer-profitability/summary',
      '/cashflow-dashboard/summary',
      '/executive-dashboard',
      '/profit-loss',
      '/balance-sheet',
      '/journal',
      '/payment-gateway-config',
    ])
      expect([url, (await ctx.as(sam).get(url)).status]).toEqual([url, 403]);
    expect(
      (await ctx.as(sam).post('/journal', { narration: 'x' })).status,
    ).toBe(403);
  });

  it("a GSTIN registered to Tara's customer: warned, routed to Tara, nothing created or revealed", async () => {
    const before = await ctx.db.customer.count();
    const check = await ctx
      .as(sam)
      .get('/customers/duplicate-check')
      .query({ gstin: '27-bbbbb-2222b-1z2' });
    expect(check.body.blocking).toEqual([
      expect.objectContaining({
        hidden: true,
        customerName: null,
        strength: 'EXACT',
        mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
      }),
    ]);
    const create = await ctx.as(sam).post('/customers', {
      customerName: 'Another Name Entirely',
      gstRegistration: gst('27BBBBB2222B1Z2'),
    });
    expect(create.status).toBe(409);
    expect(create.body).toMatchObject({
      existingHidden: true,
      mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
    });
    const raw = JSON.stringify(create.body);
    expect(raw).not.toContain('Tara Textiles');
    expect(raw).not.toContain(taraChain.customer);
    expect(await ctx.db.customer.count()).toBe(before);
    // Tara's customer and its ownership are untouched.
    expect(
      (
        await ctx.db.opportunity.findUniqueOrThrow({
          where: { id: taraChain.opp },
          include: { lead: true },
        })
      ).lead.assignedToId,
    ).toBe(tara);
  });

  it('two people creating the same new customer at once: exactly one is created', async () => {
    const body = (n: string) => ({
      customerName: n,
      gstRegistration: gst('27CCCCC3333C1Z3'),
    });
    const [a, b] = await Promise.all([
      ctx.as(sam).post('/customers', body('Racing Mills')),
      ctx.as(tara).post('/customers', body('Racing Mills Pvt')),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(
      await ctx.db.customerGSTRegistration.count({
        where: { gstin: '27CCCCC3333C1Z3' },
      }),
    ).toBe(1);
    expect(
      await ctx.db.customer.count({
        where: { customerName: { startsWith: 'Racing Mills' } },
      }),
    ).toBe(1);
  });
});

describe('Finance', () => {
  it('sees every invoice, receivable, payment and statement, but not the sales pipeline or customer list', async () => {
    expect(ids((await ctx.as(fiona).get('/sales-invoices')).body)).toEqual(
      [samChain.invoice, taraChain.invoice].sort(),
    );
    expect((await ctx.as(fiona).get('/accounts-receivable')).body).toHaveLength(
      2,
    );
    expect((await ctx.as(fiona).get('/payment-collections')).status).toBe(200);
    expect(
      (
        await ctx
          .as(fiona)
          .get(`/receipt-vouchers?salesInvoiceId=${taraChain.invoice}`)
      ).status,
    ).toBe(200);
    expect(
      (await ctx.as(fiona).get(`/customers/${taraChain.customer}/statement`))
        .status,
    ).toBe(200);
    for (const url of [
      '/collections-dashboard/summary',
      '/collections-dashboard/aging',
      '/customer-ledgers',
      '/executive-dashboard',
    ])
      expect([url, (await ctx.as(fiona).get(url)).status]).toEqual([url, 200]);
    // No leads/customers codes: the pipeline and the customer master stay closed.
    for (const url of [
      '/leads',
      '/leads/search',
      '/customers',
      '/opportunities',
    ])
      expect([url, (await ctx.as(fiona).get(url)).status]).toEqual([url, 403]);
  });

  it('without finance visibility a finance clerk sees no one else’s records and no company totals', async () => {
    expect((await ctx.as(finn).get('/sales-invoices')).body).toEqual([]);
    expect((await ctx.as(finn).get('/accounts-receivable')).body).toEqual([]);
    expect(
      (
        await ctx
          .as(finn)
          .get(`/receipt-vouchers?salesInvoiceId=${taraChain.invoice}`)
      ).status,
    ).toBe(404);
    expect(
      (await ctx.as(finn).get('/collections-dashboard/summary')).status,
    ).toBe(403);
  });

  it('finance visibility can be delegated by an administrator holding revenue.view.all', async () => {
    const r = await ctx.as(admin).patch(`/roles/${financeRole}/permissions`, {
      grant: ['finance.view.all'],
      acknowledgeSensitive: true,
    });
    expect(r.status).toBe(200); // already held: nothing changes, but it is allowed
  });
});

describe('HR and other roles', () => {
  it('have no RevenueOS commercial data', async () => {
    for (const url of [
      '/leads',
      '/leads/search',
      '/customers',
      '/sales-invoices',
      '/accounts-receivable',
      '/payment-collections',
      '/collections-dashboard/summary',
      '/customer-ledgers',
      '/executive-dashboard',
      '/sales-reports/funnel',
    ])
      expect([url, (await ctx.as(hari).get(url)).status]).toEqual([url, 403]);
  });
});

describe('payment-gateway settings', () => {
  it('need payments.gateway.manage, and secrets never come back', async () => {
    const created = await ctx.as(admin).post('/payment-gateway-config', {
      gatewayName: 'Scratch Gateway',
      gatewayType: 'RAZORPAY',
      apiKey: 'rzp_test_KEY123456',
      secretKey: 'scratch-secret-987654',
      accountNumber: '000111222333',
      isActive: false,
    });
    expect(created.status).toBe(201);
    // key and secret: never returned (credential redaction); account number: last four only
    expect(created.body.apiKey).toBeUndefined();
    expect(created.body.secretKey).toBeUndefined();
    expect(created.body.accountNumber).toBe('••••2333');
    const list = await ctx.as(admin).get('/payment-gateway-config');
    const listed = JSON.stringify(list.body);
    for (const secret of ['scratch-secret', 'rzp_test_KEY', '000111222333'])
      expect(listed).not.toContain(secret);
    expect(
      (
        await ctx.db.paymentGatewayConfig.findFirstOrThrow({
          where: { gatewayName: 'Scratch Gateway' },
        })
      ).secretKey,
    ).toBe('scratch-secret-987654');
    expect((await ctx.as(fiona).get('/payment-gateway-config')).status).toBe(
      403,
    );
    expect(
      (
        await ctx.as(sam).post('/payment-gateway-config', {
          gatewayName: 'Not Mine',
          gatewayType: 'UPI',
          isActive: true,
        })
      ).status,
    ).toBe(403);
    expect(
      await ctx.db.paymentGatewayConfig.count({
        where: { gatewayName: 'Not Mine' },
      }),
    ).toBe(0);
  });
});
