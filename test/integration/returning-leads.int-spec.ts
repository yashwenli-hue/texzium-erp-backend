/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are loosely typed */
import {
  Ctx,
  lead,
  reset,
  role,
  source,
  startApp,
  stopApp,
  user,
} from './harness';

// Returning leads, repeat enquiries and possible duplicates (lead-duplicates.ts) on a real
// database: the nine scenarios of the 2026-10-17 requirement. Enquiries are never blocked
// or merged; each keeps its own source, product, date and history; customers keep their
// owner; nothing private about a record the caller may not open is disclosed.

let ctx: Ctx;
const PRESALES = [
  'leads.view',
  'leads.create',
  'leads.edit',
  'leads.followups.view',
  'customers.view',
];
let admin: string, priya: string, plain: string, sam: string, tara: string;
let web: string, whatsapp: string, loom: string, braider: string;
let customerOfTara: string;

beforeAll(async () => {
  ctx = await startApp();
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', [
    ...PRESALES,
    'leads.assign',
    'customers.create',
    'customers.gst.manage',
    'revenue.view.all',
  ]);
  const p = await role(ctx.db, 'PRE_SALES', PRESALES);
  const n = await role(ctx.db, 'LEADS_ONLY', ['leads.view', 'leads.create']);
  const s = await role(ctx.db, 'SALES', [
    ...PRESALES,
    'customers.create',
    'customers.gst.manage',
  ]);
  admin = (await user(ctx.db, 'Admin Five', a.id)).id;
  priya = (await user(ctx.db, 'Priya Presales', p.id)).id;
  plain = (await user(ctx.db, 'Lea Leads', n.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', s.id)).id;
  tara = (await user(ctx.db, 'Tara Sales', s.id)).id;
  web = (await source(ctx.db, 'Website')).id;
  whatsapp = (await source(ctx.db, 'WhatsApp')).id;
  const item = (sku: string, productName: string) =>
    ctx.db.inventoryItem.create({
      data: {
        sku,
        productName,
        category: 'Machines',
        stockQty: 1,
        availableQty: 1,
      },
    });
  loom = (await item('NL-100', 'Needle Loom 100')).id;
  braider = (await item('BR-16', 'Braider 16')).id;

  // A customer Tara looks after (through her qualified lead and its opportunity).
  const c = await ctx.db.customer.create({
    data: {
      customerCode: 'CUST-OWN',
      customerName: 'Orbit Narrow Fabrics',
      phone: '9822200002',
    },
  });
  customerOfTara = c.id;
  await ctx.db.customerGSTRegistration.create({
    data: {
      customerId: c.id,
      gstin: '27ORBIT1234F1Z5',
      legalName: 'Orbit Narrow Fabrics',
      stateCode: '27',
      stateName: 'Maharashtra',
      addressLine1: 'x',
      city: 'Surat',
      pincode: '395003',
      isDefault: true,
    },
  });
  const tl = await lead(ctx.db, {
    customerName: 'Omkar Shah',
    companyName: 'Orbit Narrow Fabrics',
    phone: '9822200002',
    status: 'SALES_ASSIGNED',
    assignedToId: tara,
    inventoryItemId: loom,
  });
  await ctx.db.opportunity.create({
    data: {
      leadId: tl.id,
      customerId: c.id,
      title: 'Orbit looms',
      expectedValue: 1,
      probability: 50,
      expectedCloseDate: new Date('2026-12-31'),
    },
  });
});
afterAll(async () => stopApp(ctx));

const check = (who: string, q: Record<string, string>) =>
  ctx.as(who).get('/leads/duplicate-check').query(q);
const newLead = (who: string, body: Record<string, unknown>) =>
  ctx.as(who).post('/leads', body);

it('1. the same person, the same product, through another source: a potential duplicate, never blocked', async () => {
  const first = await lead(ctx.db, {
    customerName: 'Asha Rao',
    phone: '9811111111',
    sourceId: web,
    status: 'CONTACTED',
    assignedToId: priya,
    inventoryItemId: loom,
    createdAt: new Date('2026-09-01T05:00:00Z'),
  });
  const r = await check(priya, {
    phone: '+91 98111 11111',
    customerName: 'asha  rao',
    inventoryItemId: loom,
  });
  expect(r.body.leads).toEqual([
    expect.objectContaining({
      id: first.id,
      kind: 'POTENTIAL_DUPLICATE',
      strength: 'EXACT',
      sameProduct: true,
      sourceName: 'Website',
      inventoryItem: expect.objectContaining({
        productName: 'Needle Loom 100',
      }),
    }),
  ]);
  expect(r.body.person.returning).toBe(true);
  const second = await newLead(priya, {
    customerName: 'Asha Rao',
    phone: '9811111111',
    sourceId: whatsapp,
    inventoryItemId: loom,
  });
  expect(second.status).toBe(201);
  const dup = await ctx.as(priya).get(`/leads/${second.body.id}/duplicates`);
  expect(dup.body.leads[0]).toMatchObject({
    id: first.id,
    relation: 'EARLIER',
    kind: 'POTENTIAL_DUPLICATE',
  });
  // The first enquiry keeps its own source and product.
  expect(
    await ctx.db.lead.findUniqueOrThrow({
      where: { id: first.id },
      select: { sourceId: true, inventoryItemId: true },
    }),
  ).toEqual({ sourceId: web, inventoryItemId: loom });
});

it('2. the same person months later about another product: a repeat enquiry', async () => {
  const old = await lead(ctx.db, {
    customerName: 'Bala Iyer',
    phone: '9811122222',
    email: 'bala@example.com',
    inventoryItemId: loom,
    status: 'CONTACTED',
    assignedToId: priya,
    createdAt: new Date('2026-03-01T05:00:00Z'),
  });
  const r = await check(priya, {
    email: 'BALA@example.com',
    phone: '98111 22222',
    inventoryItemId: braider,
  });
  expect(r.body.leads[0]).toMatchObject({
    id: old.id,
    kind: 'REPEAT_ENQUIRY',
    sameProduct: false,
    strength: 'EXACT',
  });
  expect(r.body.summary).toMatchObject({
    potentialDuplicates: 0,
    repeatEnquiries: 1,
  });
  expect(r.body.productComparison).toBe('available');
});

it('3. a returning lead already linked to a customer: the link and its salesperson are shown', async () => {
  const r = await ctx.as(admin).get('/leads/duplicate-check').query({
    phone: '9822200002',
    customerName: 'Omkar Shah',
  });
  const earlier = r.body.leads.find((l: any) => l.customer);
  expect(earlier.customer).toMatchObject({
    id: customerOfTara,
    customerName: 'Orbit Narrow Fabrics',
    mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
    salesperson: { status: 'ASSIGNED', id: tara, fullName: 'Tara Sales' },
  });
  const tl = await ctx.db.lead.findFirstOrThrow({
    where: { customerName: 'Omkar Shah' },
  });
  const own = await ctx.as(admin).get(`/leads/${tl.id}/duplicates`);
  expect(own.body.customers).toEqual([
    expect.objectContaining({ id: customerOfTara, link: 'LINKED' }),
  ]);
});

it('4. earlier enquiries but no customer: shown as returning, the new one is recorded normally', async () => {
  await lead(ctx.db, {
    customerName: 'Chitra Nair',
    phone: '9811133333',
    status: 'LOST',
  });
  const r = await check(priya, {
    phone: '9811133333',
    customerName: 'Chitra Nair',
  });
  expect(r.body.person.returning).toBe(true);
  expect(r.body.customers).toEqual([]);
  expect(
    (
      await newLead(priya, {
        customerName: 'Chitra Nair',
        phone: '9811133333',
        sourceId: web,
      })
    ).status,
  ).toBe(201);
});

it('5. a GSTIN of a customer Tara looks after: Sam is told it exists and who looks after it, nothing else', async () => {
  const r = await check(sam, {
    companyName: 'Some Other Name',
    gstin: '27orbit1234f1z5',
  });
  expect(r.body.customers).toEqual([
    {
      hidden: true,
      link: 'MATCH',
      strength: 'EXACT',
      // the PAN inside the GSTIN matches too
      reasons: ['GSTIN', 'PAN'],
      mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
      salesperson: { status: 'ASSIGNED', id: tara, fullName: 'Tara Sales' },
    },
  ]);
  const raw = JSON.stringify(r.body);
  for (const secret of [
    'Orbit Narrow Fabrics',
    '9822200002',
    'CUST-OWN',
    customerOfTara,
  ])
    expect(raw).not.toContain(secret);
  // ...and a customer cannot be created with it: refused, masked, routed to Tara.
  const c = await ctx.as(sam).post('/customers', {
    customerName: 'Some Other Name',
    gstRegistration: {
      gstin: '27ORBIT1234F1Z5',
      legalName: 'x',
      addressLine1: 'x',
      city: 'Surat',
      pincode: '395003',
    },
  });
  expect(c.status).toBe(409);
  expect(c.body.mappedTo).toEqual([{ id: tara, fullName: 'Tara Sales' }]);
  expect(JSON.stringify(c.body)).not.toContain('Orbit Narrow Fabrics');
  expect(
    await ctx.db.customer.count({ where: { customerName: 'Some Other Name' } }),
  ).toBe(0);
});

it('6. a possible customer match the person may not open (no customers.view): exists + salesperson only', async () => {
  const r = await check(plain, { phone: '98222 00002' });
  const c = r.body.customers.find((x: any) => x.link === 'MATCH');
  expect(c).toEqual({
    hidden: true,
    link: 'MATCH',
    strength: 'POSSIBLE',
    reasons: ['PHONE'],
    mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
    salesperson: { status: 'ASSIGNED', id: tara, fullName: 'Tara Sales' },
  });
  // The matching earlier lead is Tara's: outside this person's scope, shown without details.
  const l = r.body.leads[0];
  expect(l).toMatchObject({
    hidden: true,
    handledBy: { id: tara, fullName: 'Tara Sales' },
  });
  expect(l.customerName).toBeUndefined();
  expect(l.sourceName).toBeUndefined();
});

it('7. a shared phone number with another name: a possible match, not called the same person', async () => {
  await lead(ctx.db, {
    customerName: 'Ravi Kumar',
    companyName: 'Acme',
    phone: '9811144444',
  });
  const r = await check(priya, {
    phone: '9811144444',
    customerName: 'Meena Iyer',
    companyName: 'Other Co',
  });
  expect(r.body.leads[0]).toMatchObject({
    strength: 'POSSIBLE',
    kind: 'POSSIBLE_MATCH',
    differentName: true,
  });
  expect(r.body.person.returning).toBe(false);
});

it('8. after a disqualified or lost enquiry, a new one is a legitimate repeat enquiry', async () => {
  const rejected = await lead(ctx.db, {
    customerName: 'Dev Patel',
    phone: '9811155555',
    status: 'REJECTED',
    assignedToId: priya,
    inventoryItemId: loom,
  });
  const r = await check(priya, {
    phone: '9811155555',
    customerName: 'Dev Patel',
    inventoryItemId: loom,
  });
  expect(r.body.leads[0]).toMatchObject({
    id: rejected.id,
    kind: 'REPEAT_ENQUIRY',
    sameProduct: true,
  });
  const created = await newLead(priya, {
    customerName: 'Dev Patel',
    phone: '9811155555',
    sourceId: web,
    inventoryItemId: loom,
  });
  expect(created.status).toBe(201);
  expect(
    (await ctx.db.lead.findUniqueOrThrow({ where: { id: rejected.id } }))
      .status,
  ).toBe('REJECTED');
});

it('9. at the same moment: enquiries are both kept (and flag each other), a customer is created once', async () => {
  const body = {
    customerName: 'Esha Gill',
    phone: '9811166666',
    sourceId: web,
    inventoryItemId: braider,
  };
  const [a, b] = await Promise.all([
    newLead(priya, body),
    newLead(admin, body),
  ]);
  expect([a.status, b.status]).toEqual([201, 201]);
  const dup = await ctx.as(admin).get(`/leads/${a.body.id}/duplicates`);
  expect(dup.body.leads.map((l: any) => [l.id, l.kind])).toEqual([
    [b.body.id, 'POTENTIAL_DUPLICATE'],
  ]);

  const cust = (n: string) =>
    ctx.as(admin).post('/customers', {
      customerName: n,
      gstRegistration: {
        gstin: '27ESHAG1234F1Z5',
        legalName: n,
        addressLine1: 'x',
        city: 'Pune',
        pincode: '411001',
      },
    });
  const [c1, c2] = await Promise.all([
    cust('Esha Mills'),
    cust('Esha Mills Pvt'),
  ]);
  expect([c1.status, c2.status].sort()).toEqual([201, 409]);
  expect(
    await ctx.db.customerGSTRegistration.count({
      where: { gstin: '27ESHAG1234F1Z5' },
    }),
  ).toBe(1);
});

describe("an enquiry's product", () => {
  it('must be an existing inventory item; it can be changed and cleared', async () => {
    expect(
      (
        await newLead(priya, {
          customerName: 'No Such Product',
          phone: '9811177777',
          sourceId: web,
          inventoryItemId: '00000000-0000-4000-8000-00000000dead',
        })
      ).status,
    ).toBe(404);
    const l = await newLead(priya, {
      customerName: 'Fixed Later',
      phone: '9811188888',
      sourceId: web,
    });
    expect(l.body.inventoryItem).toBeNull();
    const u = await ctx
      .as(priya)
      .patch(`/leads/${l.body.id}`, { inventoryItemId: braider });
    expect(u.status).toBe(200);
    expect(u.body.inventoryItem).toMatchObject({
      id: braider,
      productName: 'Braider 16',
    });
    const s = await ctx
      .as(priya)
      .get('/leads/search')
      .query({ product: braider });
    expect([s.status, s.body.message]).toEqual([200, undefined]);
    expect(s.body.items.map((i: any) => i.id)).toContain(l.body.id);
    expect(s.body.facets.product).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: braider,
          item: expect.objectContaining({ productName: 'Braider 16' }),
        }),
      ]),
    );
    const cleared = await ctx
      .as(priya)
      .patch(`/leads/${l.body.id}`, { inventoryItemId: null });
    expect(cleared.body.inventoryItem).toBeNull();
  });
});
