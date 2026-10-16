/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- supertest response bodies are loosely typed */
import { Ctx, lead, reset, role, startApp, stopApp, user } from './harness';

// The existing 30-day Recycle Bin, re-checked with the lifecycle v2 history columns: a lead
// whose pre-sales assignment names its subject is deleted, stays restorable for 30 days,
// is visible only to the governance permissions, and comes back with that history intact.

let ctx: Ctx;
let admin: string, sales: string, priya: string;

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const adminRole = await role(ctx.db, 'SUPER_ADMIN', [
    'leads.view',
    'leads.assign',
    'leads.delete',
    'governance.deletions.view',
    'governance.deletions.restore',
    'revenue.view.all',
  ]);
  const salesRole = await role(ctx.db, 'SALES', ['leads.view', 'leads.delete']);
  admin = (await user(ctx.db, 'Admin Seven', adminRole.id)).id;
  sales = (await user(ctx.db, 'Sam Sales', salesRole.id)).id;
  priya = (await user(ctx.db, 'Priya Presales', salesRole.id)).id;
});

it('deletes and restores a lead with its history, inside the 30-day window, for governance users only', async () => {
  const l = await lead(ctx.db, { customerName: 'Entered By Mistake' });
  expect(
    (
      await ctx
        .as(admin)
        .post('/lead-assignments', { leadId: l.id, assignedToId: priya })
    ).status,
  ).toBe(201);
  const before = await ctx.db.leadTimeline.findMany({
    where: { leadId: l.id },
    orderBy: { createdAt: 'asc' },
  });
  expect(before.map((e) => [e.action, e.subjectUserId])).toEqual([
    ['PRE_SALES_ASSIGNED', priya],
  ]);

  const preview = await ctx.as(admin).get(`/leads/${l.id}/deletion-preview`);
  expect(preview.status).toBe(200);
  expect(preview.body).toMatchObject({ eligible: true, recoveryDays: 30 });
  const del = await ctx.as(admin).del(`/leads/${l.id}`).send({
    reasonCode: 'ENTERED_IN_ERROR',
    reason: 'Test entry',
    version: preview.body.version,
  });
  expect(del.status).toBe(200);
  expect(await ctx.db.lead.count({ where: { id: l.id } })).toBe(0);

  const tomb = await ctx.db.dataDeletionRecord.findFirstOrThrow({
    where: { entityId: l.id },
  });
  const days =
    (tomb.purgeAfter.getTime() - tomb.deletedAt.getTime()) / 86_400_000;
  expect(days).toBeCloseTo(30, 3);

  // the Recycle Bin is for governance permissions only
  expect((await ctx.as(sales).get('/data-deletions')).status).toBe(403);
  expect((await ctx.as(admin).get('/data-deletions')).status).toBe(200);

  const rp = await ctx
    .as(admin)
    .get(`/data-deletions/${tomb.id}/restore-preview`);
  expect(rp.status).toBe(200);
  const version = rp.body.version ?? rp.body.preview?.version;
  expect(
    (
      await ctx
        .as(sales)
        .post(`/data-deletions/${tomb.id}/restore`, { version })
    ).status,
  ).toBe(403);
  const restored = await ctx
    .as(admin)
    .post(`/data-deletions/${tomb.id}/restore`, { version });
  expect(restored.status).toBeLessThan(300);

  const after = await ctx.db.leadTimeline.findMany({
    where: { leadId: l.id, action: 'PRE_SALES_ASSIGNED' },
  });
  expect(after.map((e) => [e.id, e.subjectUserId])).toEqual(
    before.map((e) => [e.id, e.subjectUserId]),
  );
  expect(
    (
      await ctx.db.dataDeletionRecord.findUniqueOrThrow({
        where: { id: tomb.id },
      })
    ).status,
  ).toBe('RESTORED');
});

it('a scoped user cannot delete a lead they do not work on', async () => {
  const l = await lead(ctx.db, { customerName: 'Someone Elses' });
  expect(
    (await ctx.as(sales).get(`/leads/${l.id}/deletion-preview`)).status,
  ).toBe(404);
  expect(await ctx.db.lead.count({ where: { id: l.id } })).toBe(1);
});
