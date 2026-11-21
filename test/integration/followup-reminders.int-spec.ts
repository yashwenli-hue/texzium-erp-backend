/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest response bodies are loosely typed */
import { Ctx, lead, reset, role, startApp, stopApp, user } from './harness';

// GET /lead-followups/mine (the reminder popup) and /lead-followups/calendar on a real
// database: reminders are the pending follow-ups of leads the person owns now; the
// calendar follows record scope, so a manager with revenue.view.all sees everyone's.

let ctx: Ctx;
let priya: string, omar: string, manager: string;
let priyaLead: string, omarLead: string, inactiveLead: string;
const FROM = '2026-11-01T00:00:00.000Z';
const TO = '2026-12-01T00:00:00.000Z';
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  ctx = await startApp();
  await reset(ctx.db);
  const pre = await role(ctx.db, 'PRE_SALES', [
    'leads.view',
    'leads.followups.view',
  ]);
  const mgr = await role(ctx.db, 'SALES_MANAGER', [
    'leads.view',
    'leads.followups.view',
    'revenue.view.all',
  ]);
  priya = (await user(ctx.db, 'Priya Presales', pre.id)).id;
  omar = (await user(ctx.db, 'Omar Presales', pre.id)).id;
  manager = (await user(ctx.db, 'Maya Manager', mgr.id)).id;
  priyaLead = (
    await lead(ctx.db, { customerName: 'Rao Textiles', assignedToId: priya })
  ).id;
  omarLead = (
    await lead(ctx.db, { customerName: 'Shah Mills', assignedToId: omar })
  ).id;
  inactiveLead = (
    await lead(ctx.db, {
      customerName: 'Closed Co',
      assignedToId: priya,
      isActive: false,
    })
  ).id;

  await ctx.db.leadFollowup.createMany({
    data: [
      {
        leadId: priyaLead,
        followupDate: at('2026-11-10T05:30:00Z'),
        remarks: 'Call back about the sample',
      },
      {
        leadId: priyaLead,
        followupDate: at('2026-11-12T05:30:00Z'),
        status: 'COMPLETED',
        completedAt: at('2026-11-12T06:00:00Z'),
        completedById: priya,
      },
      {
        leadId: priyaLead,
        followupDate: at('2026-11-14T05:30:00Z'),
        status: 'CANCELLED',
      },
      {
        leadId: priyaLead,
        followupDate: at('2026-12-15T05:30:00Z'),
        remarks: 'outside the window',
      },
      { leadId: inactiveLead, followupDate: at('2026-11-11T05:30:00Z') },
      {
        leadId: omarLead,
        followupDate: at('2026-11-11T05:30:00Z'),
        remarks: 'Omar call',
      },
    ],
  });
});
afterAll(async () => stopApp(ctx));

it('reminders are only my pending follow-ups on active leads I own, in the window', async () => {
  const r = await ctx
    .as(priya)
    .get(`/lead-followups/mine?from=${FROM}&to=${TO}`);
  expect(r.status).toBe(200);
  expect(r.body).toHaveLength(1);
  expect(r.body[0]).toMatchObject({
    remarks: 'Call back about the sample',
    status: 'PENDING',
    lead: {
      id: priyaLead,
      customerName: 'Rao Textiles',
      phone: '9876500000',
      assignedTo: { id: priya, fullName: 'Priya Presales' },
    },
  });

  // After the hand-off to someone else, the reminder goes with the lead.
  await ctx.db.lead.update({
    where: { id: priyaLead },
    data: { assignedToId: omar },
  });
  try {
    expect(
      (await ctx.as(priya).get(`/lead-followups/mine?from=${FROM}&to=${TO}`))
        .body,
    ).toEqual([]);
    const omars = (
      await ctx.as(omar).get(`/lead-followups/mine?from=${FROM}&to=${TO}`)
    ).body;
    expect(
      omars.map((f: { lead: { id: string } }) => f.lead.id).sort(),
    ).toEqual([omarLead, priyaLead].sort());
  } finally {
    await ctx.db.lead.update({
      where: { id: priyaLead },
      data: { assignedToId: priya },
    });
  }
});

it('"mine" and "calendar" are not taken for a lead id', async () => {
  const r = await ctx.as(priya).get('/lead-followups/mine');
  expect(r.status).toBe(400);
  expect(r.body.message).toContain('from is required');
  expect((await ctx.as(priya).get('/lead-followups/calendar')).status).toBe(
    400,
  );
});

it('the calendar shows every status in the window, within my record scope', async () => {
  const mine = (
    await ctx.as(priya).get(`/lead-followups/calendar?from=${FROM}&to=${TO}`)
  ).body;
  expect(mine.map((f: { status: string }) => f.status).sort()).toEqual([
    'CANCELLED',
    'COMPLETED',
    'PENDING',
    'PENDING',
  ]);
  expect(
    mine.every((f: { lead: { id: string } }) => f.lead.id !== omarLead),
  ).toBe(true);
  expect(
    mine.find((f: { status: string }) => f.status === 'COMPLETED').completedBy,
  ).toEqual({ id: priya, fullName: 'Priya Presales' });
});

it("a manager with revenue.view.all sees the whole company's calendar and can narrow it to one person", async () => {
  const all = (
    await ctx.as(manager).get(`/lead-followups/calendar?from=${FROM}&to=${TO}`)
  ).body;
  expect(all).toHaveLength(5);
  const omars = (
    await ctx
      .as(manager)
      .get(`/lead-followups/calendar?from=${FROM}&to=${TO}&ownerId=${omar}`)
  ).body;
  expect(omars).toHaveLength(1);
  expect(omars[0].remarks).toBe('Omar call');

  // ownerId never widens a scope: Priya asking for Omar's gets nothing.
  expect(
    (
      await ctx
        .as(priya)
        .get(`/lead-followups/calendar?from=${FROM}&to=${TO}&ownerId=${omar}`)
    ).body,
  ).toEqual([]);
});

it('needs leads.followups.view and a sensible window', async () => {
  const noFollowups = await role(ctx.db, 'VIEWER', ['leads.view']);
  const v = (await user(ctx.db, 'Vic Viewer', noFollowups.id)).id;
  expect(
    (await ctx.as(v).get(`/lead-followups/mine?from=${FROM}&to=${TO}`)).status,
  ).toBe(403);
  const tooLong = await ctx
    .as(manager)
    .get(
      `/lead-followups/calendar?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`,
    );
  expect(tooLong.status).toBe(400);
});
