/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest response bodies are loosely typed */
import { Ctx, chain, reset, role, startApp, stopApp, user } from './harness';

// GET /leads/:id/quotations on a real database: the Pre-Sales person who worked on a
// lead sees the quotations made on it and how far each got, and never a price.

let ctx: Ctx;
let priya: string, omar: string, sam: string;
let samChain: Awaited<ReturnType<typeof chain>>;

beforeAll(async () => {
  ctx = await startApp();
  await reset(ctx.db);
  const pre = await role(ctx.db, 'PRE_SALES', ['leads.view']);
  const sales = await role(ctx.db, 'SALES', ['leads.view', 'quotations.view']);
  priya = (await user(ctx.db, 'Priya Presales', pre.id)).id;
  omar = (await user(ctx.db, 'Omar Presales', pre.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', sales.id)).id;
  samChain = await chain(ctx.db, sam, 'Nair Steel Works', '27AAACN2222B1Z2');
  // Priya worked on the lead in pre-sales before it went to Sam.
  await ctx.db.leadTimeline.create({
    data: {
      leadId: samChain.lead,
      action: 'PRE_SALES_ASSIGNED',
      actorId: sam,
      subjectUserId: priya,
    },
  });
  await ctx.db.quotationLine.create({
    data: {
      quotationId: samChain.quotation,
      lineNumber: 1,
      description: 'Industrial Pump X1',
      quantity: 6,
      unitRate: 92000.55,
      taxableAmount: 552003.3,
      gstRate: 18,
      gstAmount: 99360.59,
      totalAmount: 651363.89,
    },
  });
});
afterAll(async () => stopApp(ctx));

it('Pre-Sales sees the quotation, its products and how far it got, with no price anywhere', async () => {
  // a second, still-draft quotation on the same deal
  await ctx.db.quotation.create({
    data: {
      opportunityId: samChain.opp,
      quoteDate: new Date('2026-01-01'),
      totalAmount: 77777.77,
      taxableAmount: 65913.36,
      gstAmount: 11864.41,
      gstPercent: 18,
    },
  });

  const r = await ctx.as(priya).get(`/leads/${samChain.lead}/quotations`);
  expect(r.status).toBe(200);
  expect(r.body).toHaveLength(2);
  const [placed, draft] = r.body;
  expect(placed).toMatchObject({
    id: samChain.quotation,
    progress: 'ORDER_PLACED',
    progressLabel: 'Order placed',
    opportunity: { id: samChain.opp },
    lines: [{ lineNumber: 1, description: 'Industrial Pump X1', quantity: 6 }],
  });
  expect(placed.order).not.toBeNull();
  expect(placed.proforma).not.toBeNull();
  expect(draft.progress).toBe('IN_PREPARATION');

  // No amount, rate, tax or total: neither the field names nor the numbers.
  const text = JSON.stringify(r.body);
  for (const word of [
    'amount',
    'Amount',
    'rate',
    'Rate',
    'gst',
    'Gst',
    'total',
    'price',
  ])
    expect([word, text.includes(word)]).toEqual([word, false]);
  for (const n of [
    '118000',
    '92000',
    '552003',
    '99360',
    '651363',
    '77777',
    '65913',
    '11864',
  ])
    expect([n, text.includes(n)]).toEqual([n, false]);
});

it('the progress follows the documents: approved, proforma issued, customer accepted', async () => {
  const q = await ctx.db.quotation.create({
    data: {
      opportunityId: samChain.opp,
      quoteDate: new Date('2026-02-01'),
      totalAmount: 1,
      status: 'APPROVED',
    },
  });
  const progressOf = async () =>
    (await ctx.as(priya).get(`/leads/${samChain.lead}/quotations`)).body.find(
      (x: any) => x.id === q.id,
    ).progress;
  expect(await progressOf()).toBe('APPROVED');
  const pi = await ctx.db.proformaInvoice.create({
    data: { quotationId: q.id, issueDate: new Date(), totalAmount: 1 },
  });
  expect(await progressOf()).toBe('PROFORMA_ISSUED');
  await ctx.db.proformaInvoice.update({
    where: { id: pi.id },
    data: { customerStatus: 'APPROVED' },
  });
  expect(await progressOf()).toBe('CUSTOMER_ACCEPTED');
});

it('someone who never worked on the lead gets not found', async () => {
  expect(
    (await ctx.as(omar).get(`/leads/${samChain.lead}/quotations`)).status,
  ).toBe(404);
});

it('a lead without opportunities has no quotations', async () => {
  const l = await ctx.db.lead.create({
    data: {
      customerName: 'Fresh Enquiry',
      phone: '9000000099',
      sourceId: (await ctx.db.leadSource.findFirstOrThrow()).id,
      assignedToId: priya,
      status: 'PRE_SALES_ASSIGNED',
    },
  });
  const r = await ctx.as(priya).get(`/leads/${l.id}/quotations`);
  expect(r.status).toBe(200);
  expect(r.body).toEqual([]);
});
