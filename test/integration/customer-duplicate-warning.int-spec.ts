/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest response bodies are loosely typed */
import { Ctx, lead, reset, role, startApp, stopApp, user } from './harness';

// What the duplicate-GSTIN warning says about an existing customer: who looks after it (the
// assignee of the lead behind its latest opportunity) and who created it (the actor of its
// CUSTOMER_CREATED event) - two separate facts, either of which may be unknown - and,
// for a customer the person may not open, only that it exists and who looks after it.
// Nothing is created, merged or changed by a refused save.

let ctx: Ctx;
let admin: string, sam: string, tara: string, priya: string;
const CODES = [
  'customers.view',
  'customers.create',
  'customers.gst.manage',
  'leads.view',
];
const gst = (gstin: string) => ({
  gstin,
  legalName: 'Registered Name',
  addressLine1: '1 Mill Road',
  city: 'Pune',
  pincode: '411001',
});

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', [
    ...CODES,
    'leads.assign',
    'revenue.view.all',
  ]);
  const s = await role(ctx.db, 'SALES', CODES);
  admin = (await user(ctx.db, 'Admin Eight', a.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', s.id)).id;
  tara = (await user(ctx.db, 'Tara Sales', s.id)).id;
  const p = await role(ctx.db, 'PRE_SALES', [
    ...CODES,
    'leads.assign',
    'leads.edit',
  ]);
  priya = (await user(ctx.db, 'Priya Presales', p.id)).id;
});

/** One more deal of a customer, on a lead assigned to `owner`. */
async function deal(customerId: string, owner: string) {
  const l = await lead(ctx.db, {
    customerName: 'Another contact',
    status: 'SALES_ASSIGNED',
    assignedToId: owner,
  });
  await ctx.db.opportunity.create({
    data: {
      leadId: l.id,
      customerId,
      title: 'another deal',
      expectedValue: 1,
      probability: 10,
      expectedCloseDate: new Date('2026-12-31'),
    },
  });
}

/** A customer created through the API by `by`, optionally looked after by `owner`. */
async function customer(
  by: string,
  name: string,
  gstin: string,
  owner?: string,
) {
  const c = await ctx.as(by).post('/customers', {
    customerName: name,
    phone: '9822233344',
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    gstRegistration: gst(gstin),
  });
  expect(c.status).toBe(201);
  if (owner) {
    const l = await lead(ctx.db, {
      customerName: `${name} contact`,
      status: 'SALES_ASSIGNED',
      assignedToId: owner,
    });
    await ctx.db.opportunity.create({
      data: {
        leadId: l.id,
        customerId: c.body.id,
        title: 'deal',
        expectedValue: 1,
        probability: 50,
        expectedCloseDate: new Date('2026-12-31'),
      },
    });
  }
  return c.body.id as string;
}
const check = (who: string, q: Record<string, string>) =>
  ctx.as(who).get('/customers/duplicate-check').query(q);

it('creator and salesperson known and the same person', async () => {
  const id = await customer(sam, 'Sterling Pumps', '27AAAAA1111A1Z1', sam);
  const r = await check(sam, { gstin: '27AAAAA1111A1Z1' });
  expect(r.body.blocking).toEqual([
    expect.objectContaining({
      id,
      customerName: 'Sterling Pumps',
      strength: 'EXACT',
      mappedTo: [{ id: sam, fullName: 'Sam Sales' }],
      createdBy: { id: sam, fullName: 'Sam Sales' },
    }),
  ]);
});

it('a different creator and salesperson are kept apart (the creator is not the owner)', async () => {
  await customer(admin, 'Orbit Fabrics', '27BBBBB2222B1Z2', tara);
  const r = await check(admin, { gstin: '27BBBBB2222B1Z2' });
  expect(r.body.blocking[0]).toMatchObject({
    mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
    createdBy: { id: admin, fullName: 'Admin Eight' },
  });
});

it('no salesperson, and no recorded creator, are reported as such - nothing is guessed', async () => {
  await customer(admin, 'Lonely Mills', '27CCCCC3333C1Z3');
  const legacy = await ctx.db.customer.create({
    data: { customerCode: 'CUST-OLD', customerName: 'Legacy Traders' },
  });
  await ctx.db.customerGSTRegistration.create({
    data: {
      customerId: legacy.id,
      gstin: '27DDDDD4444D1Z4',
      legalName: 'Legacy Traders',
      stateCode: '27',
      stateName: 'Maharashtra',
      addressLine1: 'x',
      city: 'Pune',
      pincode: '411001',
      isDefault: true,
    },
  });
  expect(
    (await check(admin, { gstin: '27CCCCC3333C1Z3' })).body.blocking[0],
  ).toMatchObject({
    mappedTo: [],
    createdBy: { id: admin, fullName: 'Admin Eight' },
  });
  expect(
    (await check(admin, { gstin: '27DDDDD4444D1Z4' })).body.blocking[0],
  ).toMatchObject({
    customerName: 'Legacy Traders',
    mappedTo: [],
    createdBy: null,
  });
});

it('a customer the person may not open: exists + salesperson only; no name, id or creator', async () => {
  const id = await customer(sam, 'Sterling Pumps', '27AAAAA1111A1Z1', sam);
  const r = await check(tara, { gstin: '27aaaaa1111a1z1' });
  expect(r.body.blocking).toEqual([
    {
      id: null,
      customerCode: null,
      customerName: null,
      isActive: null,
      hidden: true,
      reasons: ['GSTIN', 'PAN'],
      strength: 'EXACT',
      mappedTo: [{ id: sam, fullName: 'Sam Sales' }],
      salesperson: { status: 'ASSIGNED', id: sam, fullName: 'Sam Sales' },
    },
  ]);
  const before = await ctx.db.customer.count();
  const c = await ctx.as(tara).post('/customers', {
    customerName: 'Another Name',
    gstRegistration: gst('27AAAAA1111A1Z1'),
  });
  expect(c.status).toBe(409);
  expect(c.body).toMatchObject({
    code: 'DUPLICATE_GSTIN',
    existingHidden: true,
    mappedTo: [{ id: sam, fullName: 'Sam Sales' }],
  });
  expect(c.body.createdBy).toBeUndefined();
  expect(c.body.existing).toBeUndefined();
  const raw = JSON.stringify([r.body, c.body]);
  for (const secret of [
    'Sterling Pumps',
    id,
    '9822233344',
    'sterling@example.com',
  ])
    expect(raw).not.toContain(secret);
  expect(await ctx.db.customer.count()).toBe(before);
});

it('a refused create of a customer the person may see names it, its salesperson and creator, and saves nothing', async () => {
  const id = await customer(admin, 'Orbit Fabrics', '27BBBBB2222B1Z2', tara);
  const [customers, registrations, events] = await Promise.all([
    ctx.db.customer.count(),
    ctx.db.customerGSTRegistration.count(),
    ctx.db.customerEvent.count(),
  ]);
  const c = await ctx.as(admin).post('/customers', {
    customerName: 'Orbit Fabrics Again',
    gstRegistration: gst('27BBBBB2222B1Z2'),
  });
  expect(c.status).toBe(409);
  expect(c.body).toMatchObject({
    code: 'DUPLICATE_GSTIN',
    existing: expect.objectContaining({ id }),
    mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
    createdBy: { id: admin, fullName: 'Admin Eight' },
  });
  expect([
    await ctx.db.customer.count(),
    await ctx.db.customerGSTRegistration.count(),
    await ctx.db.customerEvent.count(),
  ]).toEqual([customers, registrations, events]);
  // ownership untouched
  const opp = await ctx.db.opportunity.findFirstOrThrow({
    where: { customerId: id },
    include: { lead: true },
  });
  expect(opp.lead.assignedToId).toBe(tara);
});

it('GSTIN formatting is normalised; a shared phone or email only warns and never blocks', async () => {
  await customer(admin, 'Sterling Pumps', '27AAAAA1111A1Z1', sam);
  for (const typed of [
    '27 aaaaa 1111 a1z1',
    '27-AAAAA-1111A-1Z1',
    '27.aaaaa.1111a.1z1',
  ])
    expect(
      (await check(admin, { gstin: typed })).body.blocking[0].strength,
    ).toBe('EXACT');
  const weak = await check(admin, {
    customerName: 'Completely Different Co',
    phone: '+91 98222 33344',
    email: 'STERLING@example.com',
  });
  expect(weak.body.blocking).toEqual([]);
  expect(weak.body.warnings).toEqual([
    expect.objectContaining({
      customerName: 'Sterling Pumps',
      strength: 'POSSIBLE',
      reasons: ['PHONE', 'EMAIL'],
      mappedTo: [{ id: sam, fullName: 'Sam Sales' }],
    }),
  ]);
  // and creating a different business that only shares the phone is allowed
  const c = await ctx.as(admin).post('/customers', {
    customerName: 'Completely Different Co',
    phone: '9822233344',
  });
  expect(c.status).toBe(201);
});

describe('the one salesperson to route to', () => {
  it('one active salesperson across all its deals: named', async () => {
    const id = await customer(admin, 'Sterling Pumps', '27AAAAA1111A1Z1', sam);
    await deal(id, sam);
    expect(
      (await check(admin, { gstin: '27AAAAA1111A1Z1' })).body.blocking[0]
        .salesperson,
    ).toEqual({
      status: 'ASSIGNED',
      id: sam,
      fullName: 'Sam Sales',
    });
  });

  it('several salespeople across its deals: not clear, nobody chosen', async () => {
    const id = await customer(admin, 'Shared Mills', '27EEEEE5555E1Z5', sam);
    await deal(id, tara);
    const m = (await check(admin, { gstin: '27EEEEE5555E1Z5' })).body
      .blocking[0];
    expect(m.salesperson).toEqual({ status: 'NOT_CLEAR', reason: 'MULTIPLE' });
    expect(m.mappedTo.map((p: any) => p.id).sort()).toEqual([sam, tara].sort());
  });

  it('its only salesperson is inactive: not clear', async () => {
    await customer(admin, 'Quiet Looms', '27FFFFF6666F1Z6', tara);
    await ctx.db.user.update({
      where: { id: tara },
      data: { status: 'INACTIVE' },
    });
    const m = (await check(admin, { gstin: '27FFFFF6666F1Z6' })).body
      .blocking[0];
    expect(m.salesperson).toEqual({ status: 'NOT_CLEAR', reason: 'INACTIVE' });
    expect(m.mappedTo).toEqual([]);
  });

  it('no deal: not clear (NONE); the creator is still only context', async () => {
    await customer(sam, 'Lonely Mills', '27CCCCC3333C1Z3');
    const m = (await check(admin, { gstin: '27CCCCC3333C1Z3' })).body
      .blocking[0];
    expect(m.salesperson).toEqual({ status: 'NOT_CLEAR', reason: 'NONE' });
    expect(m.createdBy).toEqual({ id: sam, fullName: 'Sam Sales' });
  });
});

describe("routing a lead to the matching customer's salesperson (existing assignment)", () => {
  it('an authorized pre-sales user assigns it; history, source and the customer are untouched', async () => {
    const custId = await customer(
      admin,
      'Orbit Fabrics',
      '27BBBBB2222B1Z2',
      tara,
    );
    const l = await lead(ctx.db, {
      customerName: 'Omkar',
      phone: '9822233344',
      status: 'NEW',
    });
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
          outcome: 'CONNECTED',
          remarks: 'Asked for a loom quote',
        })
      ).status,
    ).toBe(201);
    const before = await ctx.db.leadTimeline.findMany({
      where: { leadId: l.id },
      orderBy: { occurredAt: 'asc' },
    });
    const dup = await ctx.as(priya).get(`/leads/${l.id}/duplicates`);
    const match = dup.body.customers.find((c: any) => c.link === 'MATCH');
    expect(match).toMatchObject({
      hidden: true,
      salesperson: { status: 'ASSIGNED', id: tara },
    });
    const [customers, opps] = [
      await ctx.db.customer.count(),
      await ctx.db.opportunity.findMany({ where: { customerId: custId } }),
    ];
    const r = await ctx
      .as(priya)
      .post('/lead-assignments', { leadId: l.id, assignedToId: tara });
    expect(r.status).toBe(201);
    const after = await ctx.db.lead.findUniqueOrThrow({
      where: { id: l.id },
      include: { timelines: { orderBy: { occurredAt: 'asc' } } },
    });
    expect([after.assignedToId, after.status, after.sourceId]).toEqual([
      tara,
      'PRE_SALES_ASSIGNED',
      l.sourceId,
    ]);
    // every earlier event kept as it was; one assignment event added, naming Tara
    expect(
      after.timelines
        .slice(0, before.length)
        .map((t) => [t.id, t.action, t.userRemark, t.remarks]),
    ).toEqual(before.map((t) => [t.id, t.action, t.userRemark, t.remarks]));
    expect(
      after.timelines
        .slice(before.length)
        .map((t) => [t.action, t.subjectUserId]),
    ).toEqual([['PRE_SALES_ASSIGNED', tara]]);
    expect(await ctx.db.customer.count()).toBe(customers);
    expect(
      await ctx.db.opportunity.findMany({ where: { customerId: custId } }),
    ).toEqual(opps);
  });

  it('without leads.assign: refused (403); a lead outside the scope: not found (404); nothing changes', async () => {
    await customer(admin, 'Orbit Fabrics', '27BBBBB2222B1Z2', tara);
    const mine = await lead(ctx.db, {
      customerName: 'Mine',
      assignedToId: sam,
      status: 'PRE_SALES_ASSIGNED',
    });
    const other = await lead(ctx.db, {
      customerName: 'Not mine',
      status: 'NEW',
    });
    expect(
      (
        await ctx
          .as(sam)
          .post('/lead-assignments', { leadId: mine.id, assignedToId: tara })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx
          .as(priya)
          .post('/lead-assignments', { leadId: other.id, assignedToId: tara })
      ).status,
    ).toBe(404);
    expect(
      (await ctx.db.lead.findUniqueOrThrow({ where: { id: mine.id } }))
        .assignedToId,
    ).toBe(sam);
    expect(
      (await ctx.db.lead.findUniqueOrThrow({ where: { id: other.id } }))
        .assignedToId,
    ).toBeNull();
  });

  it('a lead already with sales cannot be reassigned by the existing rules (409): the UI sends it to an administrator', async () => {
    const l = await lead(ctx.db, {
      customerName: 'In sales',
      status: 'SALES_ASSIGNED',
      assignedToId: priya,
    });
    const r = await ctx
      .as(admin)
      .post('/lead-assignments', { leadId: l.id, assignedToId: tara });
    expect(r.status).toBe(409);
    expect(
      (await ctx.db.lead.findUniqueOrThrow({ where: { id: l.id } }))
        .assignedToId,
    ).toBe(priya);
  });
});
