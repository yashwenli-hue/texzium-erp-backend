/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest response bodies are loosely typed */
import { Ctx, lead, reset, role, startApp, stopApp, user } from './harness';

// BANT on a real database: Pre-Sales answers Budget, Authority, Need and Timeline on
// their own leads, the server works out the score, every save is in the lead's history,
// and a lead is handed to Sales only once its BANT is complete.

let ctx: Ctx;
let priya: string, other: string, sam: string, admin: string;
const PRE_SALES = [
  'leads.view',
  'leads.edit',
  'leads.qualify',
  'leads.reject',
  'leads.followups.view',
];

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const pre = await role(ctx.db, 'PRE_SALES', PRE_SALES);
  const sales = await role(ctx.db, 'SALES', ['leads.view', 'leads.edit']);
  const adm = await role(ctx.db, 'SUPER_ADMIN', [
    'leads.view',
    'leads.edit',
    'leads.delete',
    'leads.deactivate',
    'governance.deletions.view',
    'governance.deletions.restore',
    'revenue.view.all',
  ]);
  priya = (await user(ctx.db, 'Priya Presales', pre.id)).id;
  other = (await user(ctx.db, 'Omar Presales', pre.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', sales.id)).id;
  admin = (await user(ctx.db, 'Admin Seven', adm.id)).id;
});

const mine = () =>
  lead(ctx.db, {
    customerName: 'Kulkarni Chemicals',
    status: 'PRE_SALES_ASSIGNED',
    assignedToId: priya,
  });
const bantUrl = (id: string) => `/leads/${id}/bant`;
const qualify = (id: string) =>
  ctx.as(priya).patch(`/lead-assignments/${id}/qualify`, { salesUserId: sam });

it('an unanswered BANT: the four questions, no score, nothing complete', async () => {
  const l = await mine();
  const r = await ctx.as(priya).get(bantUrl(l.id));
  expect(r.status).toBe(200);
  expect(r.body.questions.map((q: any) => q.letter).join('')).toBe('BANT');
  expect(r.body).toMatchObject({
    score: 0,
    grade: null,
    complete: false,
    missing: ['Budget', 'Authority', 'Need', 'Timeline'],
    completedAt: null,
  });
});

it('saves as it is answered; the server works out the score; each save is in the history', async () => {
  const l = await mine();

  const first = await ctx.as(priya).put(bantUrl(l.id), {
    budget: 'CONFIRMED',
    budgetAmount: 500000,
    budgetNote: '  Approved by the board  ',
    authorityNote: '   ',
  });
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({
    score: 25,
    complete: false,
    missing: ['Authority', 'Need', 'Timeline'],
  });
  expect(first.body.answers).toMatchObject({
    budget: 'CONFIRMED',
    budgetAmount: 500000,
    budgetNote: 'Approved by the board',
    authorityNote: null,
  });

  // a later save keeps what it does not mention
  const done = await ctx.as(priya).put(bantUrl(l.id), {
    authority: 'INFLUENCER',
    need: 'URGENT',
    timeline: 'WITHIN_3_MONTHS',
  });
  expect(done.status).toBe(200);
  expect(done.body).toMatchObject({
    score: 25 + 15 + 25 + 18,
    grade: 'HOT',
    complete: true,
    missing: [],
  });
  expect(done.body.answers.budget).toBe('CONFIRMED');
  expect(done.body.completedAt).not.toBeNull();

  const events = await ctx.db.leadTimeline.findMany({
    where: { leadId: l.id, action: 'BANT_UPDATED' },
    orderBy: { createdAt: 'asc' },
  });
  expect(events.map((e) => [e.actorId, e.remarks])).toEqual([
    [
      priya,
      'BANT updated: score 25/100 so far; still to answer: Authority, Need, Timeline.',
    ],
    [priya, 'BANT completed: score 83/100 (Hot).'],
  ]);

  // completing again keeps when it was first completed
  const again = await ctx
    .as(priya)
    .put(bantUrl(l.id), { timeline: 'WITHIN_1_MONTH' });
  expect(again.body.score).toBe(90);
  expect(again.body.completedAt).toBe(done.body.completedAt);
});

it('clearing an answer makes it incomplete again', async () => {
  const l = await mine();
  await ctx.as(priya).put(bantUrl(l.id), {
    budget: 'NONE',
    authority: 'UNKNOWN',
    need: 'NONE',
    timeline: 'LATER',
  });
  const r = await ctx.as(priya).put(bantUrl(l.id), { need: null });
  expect(r.body).toMatchObject({
    complete: false,
    completedAt: null,
    missing: ['Need'],
  });
});

it('only the defined answers are accepted, and the score is never taken from the client', async () => {
  const l = await mine();
  for (const body of [
    { budget: 'LOTS' },
    { timeline: 'TOMORROW' },
    { budgetAmount: -1 },
    { budgetNote: 'x'.repeat(501) },
    { budget: 'CONFIRMED', score: 100 },
  ])
    expect([
      JSON.stringify(body),
      (await ctx.as(priya).put(bantUrl(l.id), body)).status,
    ]).toEqual([JSON.stringify(body), 400]);
  expect(await ctx.db.leadBant.count()).toBe(0);
});

it('a lead is handed to Sales only once its BANT is complete', async () => {
  const l = await mine();
  const refused = await qualify(l.id);
  expect(refused.status).toBe(409);
  expect(refused.body.message).toContain(
    'Still to answer: Budget, Authority, Need, Timeline.',
  );

  await ctx.as(priya).put(bantUrl(l.id), {
    budget: 'UNKNOWN',
    authority: 'USER_ONLY',
    need: 'EXPLORING',
  });
  const stillRefused = await qualify(l.id);
  expect(stillRefused.status).toBe(409);
  expect(stillRefused.body.message).toContain('Still to answer: Timeline.');
  expect(
    (await ctx.db.lead.findUniqueOrThrow({ where: { id: l.id } })).status,
  ).toBe('PRE_SALES_ASSIGNED');

  // complete, even with a Cold score: the score is shown, not a gate
  await ctx.as(priya).put(bantUrl(l.id), { timeline: 'LATER' });
  const ok = await qualify(l.id);
  expect(ok.status).toBe(200);
  expect(ok.body.status).toBe('SALES_ASSIGNED');
});

it("the lead list, the lead and the Leads search carry each lead's BANT score", async () => {
  const l = await mine();
  await ctx
    .as(priya)
    .put(bantUrl(l.id), { budget: 'CONFIRMED', need: 'DEFINED' });
  const list = await ctx.as(priya).get('/leads');
  const row = list.body.find((x: any) => x.id === l.id);
  expect(row.bant).toEqual({ score: 40, completedAt: null });
  const detail = await ctx.as(priya).get(`/leads/${l.id}`);
  expect(detail.body.bant).toEqual({ score: 40, completedAt: null });
  const search = await ctx.as(priya).get('/leads/search');
  expect(search.body.items.find((x: any) => x.id === l.id).bant).toEqual({
    score: 40,
    completedAt: null,
  });
});

it("someone else's lead: not found, to read or to write", async () => {
  const l = await mine();
  expect((await ctx.as(other).get(bantUrl(l.id))).status).toBe(404);
  expect(
    (await ctx.as(other).put(bantUrl(l.id), { budget: 'NONE' })).status,
  ).toBe(404);
  expect(await ctx.db.leadBant.count()).toBe(0);
});

it('a deactivated lead cannot have its BANT changed', async () => {
  const l = await mine();
  await ctx.db.lead.update({
    where: { id: l.id },
    data: {
      isActive: false,
      deactivatedAt: new Date(),
      deactivatedById: admin,
    },
  });
  expect(
    (await ctx.as(admin).put(bantUrl(l.id), { budget: 'NONE' })).status,
  ).toBe(409);
});

it('deleting a lead takes its BANT along, and restoring brings it back', async () => {
  const l = await lead(ctx.db, { customerName: 'Entered By Mistake' });
  await ctx.as(admin).put(bantUrl(l.id), {
    budget: 'CONFIRMED',
    authority: 'DECISION_MAKER',
    need: 'URGENT',
    timeline: 'WITHIN_1_MONTH',
  });
  const before = await ctx.db.leadBant.findUniqueOrThrow({
    where: { leadId: l.id },
  });

  // BANT_UPDATED is the system's record, not employee work: it does not block deleting
  const preview = await ctx.as(admin).get(`/leads/${l.id}/deletion-preview`);
  expect(preview.body.eligible).toBe(true);
  const del = await ctx.as(admin).del(`/leads/${l.id}`).send({
    reasonCode: 'ENTERED_IN_ERROR',
    reason: 'Test entry',
    version: preview.body.version,
  });
  expect(del.status).toBe(200);
  expect(await ctx.db.leadBant.count()).toBe(0);

  const tomb = await ctx.db.dataDeletionRecord.findFirstOrThrow({
    where: { entityId: l.id },
  });
  const rp = await ctx
    .as(admin)
    .get(`/data-deletions/${tomb.id}/restore-preview`);
  expect(JSON.stringify(rp.body)).toContain('BANT analysis');
  const version = rp.body.version ?? rp.body.preview?.version;
  expect(
    (
      await ctx
        .as(admin)
        .post(`/data-deletions/${tomb.id}/restore`, { version })
    ).status,
  ).toBeLessThan(300);

  const after = await ctx.db.leadBant.findUniqueOrThrow({
    where: { leadId: l.id },
  });
  expect({ ...after, updatedAt: null }).toEqual({ ...before, updatedAt: null });
});
