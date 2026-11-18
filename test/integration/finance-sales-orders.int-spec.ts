import {
  Chain,
  Ctx,
  chain,
  reset,
  role,
  startApp,
  stopApp,
  user,
} from './harness';

// Finance works from the Sales Order: it records and verifies advance receipts, gives
// the accounts commercial approval and raises the invoice. With finance visibility
// (finance.view.all, or revenue.view.all which includes it) Finance therefore sees and
// works on EVERY sales order, while leads, opportunities, quotations, proformas and the
// customer master stay closed to it (it holds none of their codes). Without finance
// visibility a finance clerk sees only orders under leads they worked on (none), as
// before. Sales keeps seeing only its own orders.

let ctx: Ctx;
const FINANCE = [
  'invoices.view',
  'invoices.create',
  'collections.view',
  'collections.record',
  'salesorders.view',
  'salesorders.paymentterms.view',
  'salesorders.advancereceipts.view',
  'salesorders.advancereceipts.create',
  'salesorders.advancereceipts.verify',
  'salesorders.advancereceipts.retract',
  'salesorders.commercialapproval.view',
  'salesorders.commercialapproval.approve',
  'salesorders.commercialapproval.retract',
];
const SALES = [
  'leads.view',
  'opportunities.view',
  'customers.view',
  'quotations.view',
  'proformas.view',
  'salesorders.view',
  'salesorders.paymentterms.view',
];
let fiona: string, finn: string, sam: string, tara: string;
let samChain: Chain, taraChain: Chain;

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

beforeAll(async () => {
  ctx = await startApp();
  await reset(ctx.db);
  const f = await role(ctx.db, 'FINANCE', [...FINANCE, 'finance.view.all']);
  const fc = await role(ctx.db, 'FINANCE_CLERK', FINANCE);
  const s = await role(ctx.db, 'SALES', SALES);
  fiona = (await user(ctx.db, 'Fiona Finance', f.id)).id;
  finn = (await user(ctx.db, 'Finn Clerk', fc.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', s.id)).id;
  tara = (await user(ctx.db, 'Tara Sales', s.id)).id;
  samChain = await chain(ctx.db, sam, 'Sterling Pumps', '27AAAAA1111A1Z1');
  taraChain = await chain(ctx.db, tara, 'Tara Textiles', '27BBBBB2222B1Z2');
});

afterAll(async () => {
  await stopApp(ctx);
});

describe('Finance with finance visibility', () => {
  it('sees every sales order, its history and its payment terms', async () => {
    const list = await ctx.as(fiona).get('/sales-orders');
    expect(list.status).toBe(200);
    expect(ids(list.body)).toEqual([samChain.order, taraChain.order].sort());
    for (const order of [samChain.order, taraChain.order])
      expect(
        (await ctx.as(fiona).get(`/sales-orders/${order}/events`)).status,
      ).toBe(200);
    expect((await ctx.as(fiona).get('/sales-order-payment-terms')).status).toBe(
      200,
    );
  });

  it("gives the commercial approval on any salesperson's order, and reaches it to retract", async () => {
    await ctx.db.salesOrder.update({
      where: { id: taraChain.order },
      data: { status: 'PENDING_ACCOUNTS_APPROVAL' },
    });
    const approved = await ctx
      .as(fiona)
      .post('/accounts-commercial-approval/create', {
        salesOrderId: taraChain.order,
      });
    expect(approved.status).toBe(201);
    expect(
      (await ctx.db.salesOrder.findUnique({ where: { id: taraChain.order } }))
        ?.status,
    ).toBe('READY_FOR_DISPATCH_ORDER');

    const approvals = await ctx.as(fiona).get('/accounts-commercial-approval');
    expect(approvals.status).toBe(200);
    expect(approvals.body.map((a: { id: string }) => a.id)).toContain(
      approved.body.approval.id,
    );

    // Finance reaches the approval (no 404). The order already has an invoice in
    // this fixture, so the retraction itself is refused by the workflow rule.
    const retracted = await ctx
      .as(fiona)
      .post(
        `/accounts-commercial-approval/${approved.body.approval.id}/retract`,
        {
          reason: 'Approved against the wrong terms',
        },
      );
    expect(retracted.status).toBe(409);
    expect(retracted.body.message).toMatch(/Sales Invoice/);
  });

  it('still cannot open leads, deals, quotations, proformas or customers, or cancel an order', async () => {
    for (const url of [
      '/leads',
      '/opportunities',
      '/quotations',
      '/proforma-invoices',
      '/customers',
    ])
      expect([url, (await ctx.as(fiona).get(url)).status]).toEqual([url, 403]);
    expect(
      (
        await ctx
          .as(fiona)
          .post(`/sales-orders/${samChain.order}/cancel`, { reason: 'no' })
      ).status,
    ).toBe(403);
  });
});

describe('a finance clerk without finance visibility', () => {
  it('sees no one else’s orders and cannot approve them', async () => {
    expect((await ctx.as(finn).get('/sales-orders')).body).toEqual([]);
    expect(
      (await ctx.as(finn).get(`/sales-orders/${samChain.order}/events`)).status,
    ).toBe(404);
    await ctx.db.salesOrder.update({
      where: { id: samChain.order },
      data: { status: 'PENDING_ACCOUNTS_APPROVAL' },
    });
    expect(
      (
        await ctx.as(finn).post('/accounts-commercial-approval/create', {
          salesOrderId: samChain.order,
        })
      ).status,
    ).toBe(404);
    expect(
      (await ctx.as(finn).get('/accounts-commercial-approval')).body,
    ).toEqual([]);
  });
});

describe('Sales is unchanged', () => {
  it("sees only its own orders, never another salesperson's", async () => {
    expect(ids((await ctx.as(sam).get('/sales-orders')).body)).toEqual([
      samChain.order,
    ]);
    expect(
      (await ctx.as(sam).get(`/sales-orders/${taraChain.order}/events`)).status,
    ).toBe(404);
    expect((await ctx.as(tara).get('/sales-order-payment-terms')).status).toBe(
      200,
    );
  });
});
