/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- supertest response bodies are loosely typed */
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

// Backend-enforced record visibility (record-scope.ts) on a real database, with two
// salespeople working different customers, a pre-sales person who handed a lead over, and
// an administrator. Every way a record can be reached is tried for the record that is not
// the caller's: lists, details, writes, documents, statements, duplicate checks, conflict
// bodies, reports and share history.

let ctx: Ctx;
const WORK = [
  'leads.view',
  'leads.edit',
  'leads.status.update',
  'leads.assign',
  'leads.qualify',
  'leads.reject',
  'leads.followups.view',
  'leads.followups.create',
  'opportunities.view',
  'opportunities.edit',
  'opportunities.create',
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.gst.manage',
  'quotations.view',
  'proformas.view',
  'salesorders.view',
  'invoices.view',
  'invoices.document.view',
  'collections.view',
  'content.view',
  'content.share',
  'salesorders.paymentterms.view',
  'salesorders.advancereceipts.view',
  'salesorders.commercialapproval.view',
];
let admin: string, sam: string, tara: string, priya: string;
let samChain: Chain,
  taraChain: Chain,
  handedLead: string,
  sharedCustomer: string,
  samOppOnShared: string,
  taraOppOnShared: string;

beforeAll(async () => {
  ctx = await startApp();
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', [...WORK, 'revenue.view.all']);
  const s = await role(ctx.db, 'SALES', WORK);
  admin = (await user(ctx.db, 'Admin Three', a.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', s.id)).id;
  tara = (await user(ctx.db, 'Tara Sales', s.id)).id;
  priya = (await user(ctx.db, 'Priya Presales', s.id)).id;
  samChain = await chain(ctx.db, sam, 'Sterling Pumps', '27AAAAA1111A1Z1');
  taraChain = await chain(ctx.db, tara, 'Tara Textiles', '27BBBBB2222B1Z2');
  // A customer both of them sell to, each through their own opportunity.
  const shared = await ctx.db.customer.create({
    data: { customerCode: 'CUST-SHARE', customerName: 'Shared Mills' },
  });
  sharedCustomer = shared.id;
  const ls = await lead(ctx.db, {
    customerName: 'Shared A',
    status: 'SALES_ASSIGNED',
    assignedToId: sam,
  });
  const lt = await lead(ctx.db, {
    customerName: 'Shared B',
    status: 'SALES_ASSIGNED',
    assignedToId: tara,
  });
  samOppOnShared = (
    await ctx.db.opportunity.create({
      data: {
        leadId: ls.id,
        customerId: shared.id,
        title: 'Sam on shared',
        expectedValue: 1,
        probability: 1,
        expectedCloseDate: new Date(),
      },
    })
  ).id;
  taraOppOnShared = (
    await ctx.db.opportunity.create({
      data: {
        leadId: lt.id,
        customerId: shared.id,
        title: 'Tara on shared',
        expectedValue: 1,
        probability: 1,
        expectedCloseDate: new Date(),
      },
    })
  ).id;
  // Priya worked a lead in pre-sales, then it was qualified to Sam.
  const h = await lead(ctx.db, { customerName: 'Handed Over' });
  handedLead = h.id;
  expect(
    (
      await ctx
        .as(admin)
        .post('/lead-assignments', { leadId: h.id, assignedToId: priya })
    ).status,
  ).toBe(201);
  expect(
    (
      await ctx
        .as(priya)
        .patch(`/lead-assignments/${h.id}/qualify`, { salesUserId: sam })
    ).status,
  ).toBe(200);
});
afterAll(async () => stopApp(ctx));

const ids = (body: Array<{ id: string }>) => body.map((r) => r.id).sort();

describe('lists contain only what the caller works on', () => {
  it('leads', async () => {
    const all = await ctx.as(admin).get('/leads');
    const mine = await ctx.as(sam).get('/leads');
    const hers = await ctx.as(tara).get('/leads');
    expect(mine.body.length + hers.body.length).toBeLessThan(
      all.body.length + 1,
    );
    expect(ids(mine.body)).toContain(samChain.lead);
    expect(ids(mine.body)).toContain(handedLead);
    expect(ids(mine.body)).not.toContain(taraChain.lead);
    expect(ids(hers.body)).not.toContain(samChain.lead);
    expect(ids(hers.body)).not.toContain(handedLead);
  });

  it('pre-sales keeps sight of the lead it handed to sales', async () => {
    expect(ids((await ctx.as(priya).get('/leads')).body)).toEqual([handedLead]);
    expect((await ctx.as(priya).get(`/leads/${handedLead}`)).status).toBe(200);
  });

  it('opportunities, quotations, Proformas, sales orders, invoices, GST registrations', async () => {
    for (const [url, mine, theirs] of [
      ['/opportunities', samChain.opp, taraChain.opp],
      ['/quotations', samChain.quotation, taraChain.quotation],
      ['/proforma-invoices', samChain.proforma, taraChain.proforma],
      ['/sales-orders', samChain.order, taraChain.order],
      ['/sales-invoices', samChain.invoice, taraChain.invoice],
      ['/customer-gst', samChain.gst, taraChain.gst],
    ] as const) {
      const r = await ctx.as(sam).get(url);
      expect([url, r.status]).toEqual([url, 200]);
      expect([
        url,
        ids(r.body).includes(mine),
        ids(r.body).includes(theirs),
      ]).toEqual([url, true, false]);
      expect(ids((await ctx.as(admin).get(url)).body)).toEqual(
        expect.arrayContaining([mine, theirs]),
      );
    }
  });

  it("customers: own and shared ones, not the other salesperson's", async () => {
    const r = ids((await ctx.as(sam).get('/customers')).body);
    expect(r).toEqual(
      expect.arrayContaining([samChain.customer, sharedCustomer]),
    );
    expect(r).not.toContain(taraChain.customer);
  });

  it("a shared customer's overview shows only the caller's own deal", async () => {
    const r = await ctx.as(sam).get(`/customers/${sharedCustomer}/overview`);
    expect(r.status).toBe(200);
    const titles = JSON.stringify(r.body);
    expect(titles).toContain(samOppOnShared);
    expect(titles).not.toContain(taraOppOnShared);
    expect(
      JSON.stringify(
        (await ctx.as(admin).get(`/customers/${sharedCustomer}/overview`)).body,
      ),
    ).toContain(taraOppOnShared);
  });
});

describe('someone else\'s record answers "not found", for reads and writes alike', () => {
  const notFound = async (
    req: Promise<{ status: number }> | { status: number },
    label: string,
  ) => {
    expect([label, (await req).status]).toEqual([label, 404]);
  };

  it('every route that takes its id', async () => {
    const t = taraChain;
    await notFound(ctx.as(sam).get(`/leads/${t.lead}`), 'lead detail');
    await notFound(
      ctx.as(sam).patch(`/leads/${t.lead}`, { companyName: 'Hijacked' }),
      'lead edit',
    );
    await notFound(
      ctx.as(sam).post(`/leads/${t.lead}/activities`, {
        activityType: 'CALL',
        outcome: 'NOT_CONNECTED',
      }),
      'lead activity',
    );
    await notFound(
      ctx.as(sam).post('/lead-status', { leadId: t.lead, status: 'CONTACTED' }),
      'lead status',
    );
    await notFound(
      ctx.as(sam).patch(`/lead-assignments/${t.lead}/reject`, { reason: 'x' }),
      'lead reject',
    );
    await notFound(
      ctx.as(sam).get(`/lead-followups/${t.lead}`),
      'lead follow-ups',
    );
    await notFound(
      ctx.as(sam).get(`/opportunities/${t.opp}`),
      'opportunity detail',
    );
    await notFound(
      ctx.as(sam).patch(`/opportunities/${t.opp}/stage`, {
        fromStage: 'QUALIFIED',
        toStage: 'PROPOSAL',
      }),
      'opportunity stage',
    );
    await notFound(
      ctx.as(sam).post('/opportunities', {
        leadId: t.lead,
        title: 'x',
        expectedValue: 1,
        probability: 1,
        expectedCloseDate: '2026-12-31',
      }),
      'opportunity on their lead',
    );
    await notFound(
      ctx.as(sam).get(`/customers/${t.customer}`),
      'customer detail',
    );
    await notFound(
      ctx.as(sam).get(`/customers/${t.customer}/overview`),
      'customer overview',
    );
    await notFound(
      ctx.as(sam).get(`/customers/${t.customer}/events`),
      'customer history',
    );
    await notFound(
      ctx.as(sam).patch(`/customers/${t.customer}`, { phone: '9999999999' }),
      'customer edit',
    );
    await notFound(
      ctx.as(sam).get(`/customers/${t.customer}/statement`),
      'statement',
    );
    await notFound(
      ctx.as(sam).get(`/customers/${t.customer}/statement.pdf`),
      'statement PDF',
    );
    await notFound(
      ctx.as(sam).get(`/customer-gst/${t.gst}`),
      'GST registration',
    );
    await notFound(
      ctx.as(sam).get(`/quotations/${t.quotation}/document.pdf`),
      'quotation PDF',
    );
    await notFound(
      ctx.as(sam).get(`/quotations/${t.quotation}/events`),
      'quotation history',
    );
    await notFound(
      ctx.as(sam).get(`/proforma-invoices/${t.proforma}/document.pdf`),
      'Proforma PDF',
    );
    await notFound(
      ctx.as(sam).get(`/sales-orders/${t.order}/events`),
      'sales order history',
    );
    await notFound(
      ctx.as(sam).get(`/sales-invoices/${t.invoice}/document.pdf`),
      'invoice PDF',
    );
    await notFound(
      ctx.as(sam).get(`/payment-collections/invoices/${t.invoice}`),
      'invoice payments',
    );
    await notFound(
      ctx.as(sam).post(`/payment-links/${t.invoice}/generate`),
      'payment link',
    );
    // nothing was changed by any of them
    expect(
      (await ctx.db.lead.findUniqueOrThrow({ where: { id: t.lead } }))
        .companyName,
    ).toBe('Tara Textiles');
    expect(await ctx.db.leadTimeline.count({ where: { leadId: t.lead } })).toBe(
      0,
    );
    expect(await ctx.db.opportunity.count({ where: { leadId: t.lead } })).toBe(
      1,
    );
  });

  it('the same "not found" as for an id that does not exist', async () => {
    const missing = await ctx
      .as(sam)
      .get('/leads/00000000-0000-4000-8000-00000000dead');
    const theirs = await ctx.as(sam).get(`/leads/${taraChain.lead}`);
    expect([missing.status, missing.body.message]).toEqual([
      theirs.status,
      theirs.body.message,
    ]);
  });
});

describe('duplicate checks and refusals do not reveal a customer the caller cannot see', () => {
  it('the duplicate check says a match exists, without naming it', async () => {
    const r = await ctx
      .as(sam)
      .get(
        '/customers/duplicate-check?customerName=Tara%20Textiles&gstin=27BBBBB2222B1Z2',
      );
    expect(r.status).toBe(200);
    expect(r.body.blocking).toEqual([
      {
        id: null,
        customerCode: null,
        customerName: null,
        isActive: null,
        hidden: true,
        reasons: ['GSTIN', 'PAN', 'NAME'],
        strength: 'EXACT',
        // who looks after it (routing), never the customer itself
        mappedTo: [{ id: tara, fullName: 'Tara Sales' }],
        salesperson: { status: 'ASSIGNED', id: tara, fullName: 'Tara Sales' },
      },
    ]);
    expect(JSON.stringify(r.body)).not.toContain(taraChain.customer);
    const own = await ctx
      .as(tara)
      .get('/customers/duplicate-check?customerName=Tara%20Textiles');
    expect(own.body.blocking[0]).toMatchObject({
      id: taraChain.customer,
      customerName: 'Tara Textiles',
    });
  });

  it('creating the same customer is refused without naming the existing one', async () => {
    const r = await ctx
      .as(sam)
      .post('/customers', { customerName: 'tara  textiles' });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      code: 'DUPLICATE_NAME',
      existingHidden: true,
    });
    expect(r.body.existing).toBeUndefined();
    expect(r.body.message).not.toMatch(/CUST-|Tara Textiles/);
    const g = await ctx.as(sam).post('/customers', {
      customerName: 'Fresh Name',
      gstRegistration: {
        gstin: '27BBBBB2222B1Z2',
        legalName: 'x',
        addressLine1: 'x',
        city: 'Pune',
        pincode: '411001',
      },
    });
    expect(g.status).toBe(409);
    expect(g.body.existing).toBeUndefined();
    expect(
      await ctx.db.customer.count({ where: { customerName: 'Fresh Name' } }),
    ).toBe(0);
  });

  it('an administrator is told which customer it is', async () => {
    const r = await ctx
      .as(admin)
      .post('/customers', { customerName: 'Tara Textiles' });
    expect(r.status).toBe(409);
    expect(r.body.existing).toMatchObject({ id: taraChain.customer });
  });
});

describe('company-wide figures need revenue.view.all', () => {
  // (The collection-reminders controller is gated the same way but is not mounted in
  // AppModule, so it answers 404 to everyone.)
  it('sales reports', async () => {
    for (const url of [
      '/sales-reports/funnel',
      '/sales-reports/revenue-summary',
      '/sales-reports/salesperson-performance',
      '/sales-reports/customer-revenue',
    ]) {
      expect([url, (await ctx.as(sam).get(url)).status]).toEqual([url, 403]);
      expect([url, (await ctx.as(admin).get(url)).status]).toEqual([url, 200]);
    }
  });
});

describe('content share history and sharing', () => {
  it('shows only shares to records the caller may see, and refuses sharing to one they may not', async () => {
    const asset = await ctx.db.contentAsset.create({
      data: { title: 'Loom brochure', kind: 'CATALOGUE' },
    });
    const file = await ctx.db.contentFile.create({
      data: {
        assetId: asset.id,
        version: 1,
        storageKey: `k-${asset.id}`,
        originalName: 'b.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        sha256: 'x',
      },
    });
    for (const [leadId, actorId] of [
      [samChain.lead, sam],
      [taraChain.lead, tara],
    ]) {
      await ctx.db.contentShare.create({
        data: {
          assetId: asset.id,
          fileId: file.id,
          version: 1,
          targetType: 'LEAD',
          leadId,
          channel: 'DOWNLOAD',
          actorId,
        },
      });
    }
    const mine = await ctx.as(sam).get(`/content-assets/${asset.id}/shares`);
    expect(mine.status).toBe(200);
    expect(mine.body).toHaveLength(1);
    expect(JSON.stringify(mine.body)).not.toContain(taraChain.lead);
    expect(
      (await ctx.as(admin).get(`/content-assets/${asset.id}/shares`)).body,
    ).toHaveLength(2);
    const r = await ctx.as(sam).post(`/content-assets/${asset.id}/shares`, {
      targetType: 'LEAD',
      targetId: taraChain.lead,
      channel: 'DOWNLOAD',
    });
    expect(r.status).toBe(404);
    expect(await ctx.db.contentShare.count()).toBe(2);
  });
});
