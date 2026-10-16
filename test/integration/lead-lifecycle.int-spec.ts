import { Ctx, lead, reset, role, startApp, stopApp, user } from './harness';

// Lead lifecycle v2 on a real database: pre-qualification moves, Underqualified,
// qualification (including the formerly stuck Qualified), rejection and reopening,
// call outcomes (CNC), and the opportunity gate.

let ctx: Ctx;
const ALL = [
  'leads.view', 'leads.create', 'leads.edit', 'leads.status.update', 'leads.assign',
  'leads.qualify', 'leads.reject', 'leads.reopen', 'opportunities.create', 'opportunities.view',
  'revenue.view.all',
];
let admin: string, presales: string, sales: string, noReopen: string;

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));

beforeEach(async () => {
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', ALL);
  const limited = await role(ctx.db, 'NO_REOPEN', ALL.filter((c) => c !== 'leads.reopen'));
  admin = (await user(ctx.db, 'Admin One', a.id)).id;
  presales = (await user(ctx.db, 'Priya Presales', a.id)).id;
  sales = (await user(ctx.db, 'Sam Sales', a.id)).id;
  noReopen = (await user(ctx.db, 'Nora Noreopen', limited.id)).id;
});

const events = (leadId: string) =>
  ctx.db.leadTimeline.findMany({ where: { leadId }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] });

describe('pre-qualification status moves (POST /lead-status)', () => {
  it('moves New -> Contacted -> Underqualified, recording the actor and the remark', async () => {
    const l = await lead(ctx.db, { customerName: 'Asha Rao' });
    let r = await ctx.as(presales).post('/lead-status', { leadId: l.id, status: 'CONTACTED', expectedStatus: 'NEW' });
    expect(r.status).toBe(201);
    r = await ctx.as(presales).post('/lead-status', { leadId: l.id, status: 'UNDERQUALIFIED', remarks: '  Budget next quarter  ' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('UNDERQUALIFIED');
    const ev = await events(l.id);
    expect(ev.map((e) => [e.action, e.actorId, e.userRemark, e.remarks])).toEqual([
      ['STATUS_UPDATED', presales, null, 'Status changed from New to Contacted.'],
      ['STATUS_UPDATED', presales, 'Budget next quarter', 'Status changed from Contacted to Underqualified.'],
    ]);
  });

  it('refuses statuses that have their own governed action, and a stale screen, without writing', async () => {
    const l = await lead(ctx.db, { customerName: 'Bharat Mills' });
    for (const status of ['QUALIFIED', 'SALES_ASSIGNED', 'REJECTED', 'WON', 'PRE_SALES_ASSIGNED']) {
      const r = await ctx.as(admin).post('/lead-status', { leadId: l.id, status });
      expect([status, r.status]).toEqual([status, 409]);
    }
    expect((await ctx.as(admin).post('/lead-status', { leadId: l.id, status: 'CONTACTED', expectedStatus: 'UNDERQUALIFIED' })).status).toBe(409);
    expect((await ctx.as(admin).post('/lead-status', { leadId: l.id, status: 'NONSENSE' })).status).toBe(400);
    expect((await ctx.as(admin).post('/lead-status', { leadId: l.id, status: 'NEW' })).status).toBe(409); // already New
    expect(await events(l.id)).toHaveLength(0);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('NEW');
  });

  it('refuses a move on a closed or qualified lead', async () => {
    const r1 = await lead(ctx.db, { customerName: 'Closed Co', status: 'REJECTED' });
    const r2 = await lead(ctx.db, { customerName: 'Sales Co', status: 'SALES_ASSIGNED', assignedToId: sales });
    expect((await ctx.as(admin).post('/lead-status', { leadId: r1.id, status: 'CONTACTED' })).body.message).toBe('This lead is closed (Rejected); reopen it first.');
    expect((await ctx.as(admin).post('/lead-status', { leadId: r2.id, status: 'CONTACTED' })).status).toBe(409);
  });
});

describe('qualification', () => {
  it('qualifies an Underqualified lead and records the sales user as the subject', async () => {
    const l = await lead(ctx.db, { customerName: 'Chetan Traders', status: 'UNDERQUALIFIED', assignedToId: presales });
    const r = await ctx.as(presales).patch(`/lead-assignments/${l.id}/qualify`, { salesUserId: sales });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'SALES_ASSIGNED', assignedToId: sales });
    const [e] = await events(l.id);
    expect(e).toMatchObject({ action: 'LEAD_QUALIFIED', actorId: presales, subjectUserId: sales });
  });

  it('hands a lead marked Qualified without a sales hand-off to sales (it was stuck before)', async () => {
    const l = await lead(ctx.db, { customerName: 'Legacy Qualified', status: 'QUALIFIED' });
    const r = await ctx.as(admin).patch(`/lead-assignments/${l.id}/qualify`, { salesUserId: sales });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('SALES_ASSIGNED');
  });

  it('records the pre-sales assignee as the subject of PRE_SALES_ASSIGNED', async () => {
    const l = await lead(ctx.db, { customerName: 'Delta Fabrics' });
    expect((await ctx.as(admin).post('/lead-assignments', { leadId: l.id, assignedToId: presales })).status).toBe(201);
    const [e] = await events(l.id);
    expect(e).toMatchObject({ action: 'PRE_SALES_ASSIGNED', actorId: admin, subjectUserId: presales });
  });
});

describe('reopening a rejected lead', () => {
  it('returns it to Contacted with the reason, keeping the rejection in history', async () => {
    const l = await lead(ctx.db, { customerName: 'Eagle Exports', assignedToId: presales, status: 'PRE_SALES_ASSIGNED' });
    expect((await ctx.as(presales).patch(`/lead-assignments/${l.id}/reject`, { reason: 'No budget' })).status).toBe(200);
    const r = await ctx.as(admin).patch(`/lead-assignments/${l.id}/reopen`, { reason: '  Budget approved after all  ' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'CONTACTED', assignedToId: presales });
    const ev = await events(l.id);
    expect(ev.map((e) => [e.action, e.actorId, e.userRemark])).toEqual([
      ['LEAD_REJECTED', presales, 'No budget'],
      ['LEAD_REOPENED', admin, 'Budget approved after all'],
    ]);
    // and it can be qualified again
    expect((await ctx.as(admin).patch(`/lead-assignments/${l.id}/qualify`, { salesUserId: sales })).status).toBe(200);
  });

  it('needs a reason, the permission, and a rejected lead', async () => {
    const l = await lead(ctx.db, { customerName: 'Falcon Felt', status: 'REJECTED' });
    expect((await ctx.as(admin).patch(`/lead-assignments/${l.id}/reopen`, { reason: '   ' })).status).toBe(400);
    expect((await ctx.as(admin).patch(`/lead-assignments/${l.id}/reopen`, {})).status).toBe(400);
    expect((await ctx.as(noReopen).patch(`/lead-assignments/${l.id}/reopen`, { reason: 'x' })).status).toBe(403);
    const open = await lead(ctx.db, { customerName: 'Open Lead' });
    expect((await ctx.as(admin).patch(`/lead-assignments/${open.id}/reopen`, { reason: 'x' })).status).toBe(409);
    expect(await events(l.id)).toHaveLength(0);
  });

  it('lets exactly one of two simultaneous reopens through', async () => {
    const l = await lead(ctx.db, { customerName: 'Garnet Industries', status: 'REJECTED' });
    const [a, b] = await Promise.all([
      ctx.as(admin).patch(`/lead-assignments/${l.id}/reopen`, { reason: 'first' }),
      ctx.as(presales).patch(`/lead-assignments/${l.id}/reopen`, { reason: 'second' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await events(l.id)).filter((e) => e.action === 'LEAD_REOPENED')).toHaveLength(1);
  });
});

describe('call outcomes (CNC)', () => {
  it('records a call that did not connect, with or without a remark, and leaves the status alone', async () => {
    const l = await lead(ctx.db, { customerName: 'Harbour Ropes', status: 'CONTACTED' });
    let r = await ctx.as(presales).post(`/leads/${l.id}/activities`, { activityType: 'CALL', outcome: 'NOT_CONNECTED' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ action: 'ACTIVITY_CALL', outcome: 'NOT_CONNECTED', remarks: null, actorId: presales, source: 'EMPLOYEE' });
    r = await ctx.as(presales).post(`/leads/${l.id}/activities`, { activityType: 'CALL', outcome: 'CONNECTED', remarks: 'Wants a demo' });
    expect(r.status).toBe(201);
    expect((await ctx.db.lead.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('CONTACTED');
  });

  it('refuses an outcome on anything but a call, an unknown outcome, and an empty entry', async () => {
    const l = await lead(ctx.db, { customerName: 'Indigo Looms' });
    expect((await ctx.as(presales).post(`/leads/${l.id}/activities`, { activityType: 'MEETING', outcome: 'CONNECTED', remarks: 'x' })).status).toBe(400);
    expect((await ctx.as(presales).post(`/leads/${l.id}/activities`, { activityType: 'CALL', outcome: 'MAYBE' })).status).toBe(400);
    expect((await ctx.as(presales).post(`/leads/${l.id}/activities`, { activityType: 'CALL' })).status).toBe(400);
    expect((await ctx.as(presales).post(`/leads/${l.id}/activities`, { activityType: 'EMAIL', remarks: '  ' })).status).toBe(400);
    expect(await events(l.id)).toHaveLength(0);
  });

  it('is also enforced by the database', async () => {
    const l = await lead(ctx.db, { customerName: 'Jade Weaves' });
    await expect(
      ctx.db.leadTimeline.create({ data: { leadId: l.id, action: 'ACTIVITY_MEETING', activityType: 'MEETING', source: 'EMPLOYEE', outcome: 'CONNECTED' } }),
    ).rejects.toThrow(/LeadTimeline_outcome_check/);
    await expect(
      ctx.db.leadTimeline.create({ data: { leadId: l.id, action: 'ACTIVITY_CALL', activityType: 'CALL', source: 'EMPLOYEE', outcome: 'BUSY' } }),
    ).rejects.toThrow(/LeadTimeline_outcome_check/);
  });
});

describe('opportunities only for qualified leads', () => {
  const body = (leadId: string) => ({ leadId, title: 'Needle loom', expectedValue: 100000, probability: 40, expectedCloseDate: '2026-12-31' });

  it('refuses a lead before qualification or closed, and accepts a qualified one', async () => {
    for (const status of ['NEW', 'CONTACTED', 'UNDERQUALIFIED', 'PRE_SALES_ASSIGNED', 'REJECTED', 'LOST'] as const) {
      const l = await lead(ctx.db, { customerName: `Gate ${status}`, status });
      const r = await ctx.as(admin).post('/opportunities', body(l.id));
      expect([status, r.status]).toEqual([status, 409]);
    }
    const ok = await lead(ctx.db, { customerName: 'Gate ok', status: 'SALES_ASSIGNED', assignedToId: sales });
    expect((await ctx.as(admin).post('/opportunities', body(ok.id))).status).toBe(201);
    expect(await ctx.db.opportunity.count()).toBe(1);
  });
});

describe('creating a lead', () => {
  it('records who created it', async () => {
    const s = await ctx.db.leadSource.create({ data: { name: 'Trade fair' } });
    const r = await ctx.as(presales).post('/leads', { customerName: 'Kiran Rao', phone: '9876543210', sourceId: s.id });
    expect(r.status).toBe(201);
    expect((await events(r.body.id))[0]).toMatchObject({ action: 'LEAD_CREATED', actorId: presales });
  });
});
