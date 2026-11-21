/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest response bodies are loosely typed */
import {
  Ctx,
  completeBant,
  lead,
  reset,
  role,
  startApp,
  stopApp,
  user,
} from './harness';

// GET /leads/search on a real database: phone search however the number is written,
// pre-sales involvement from history, the other filters, paging, facets that agree with
// the results, and the caller's record scope throughout.

let ctx: Ctx;
const WORK = [
  'leads.view',
  'leads.edit',
  'leads.assign',
  'leads.qualify',
  'leads.reject',
  'leads.status.update',
  'leads.followups.create',
];
let admin: string, priya: string, raj: string, sam: string, tara: string;

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', [...WORK, 'revenue.view.all']);
  const w = await role(ctx.db, 'STAFF', WORK);
  admin = (await user(ctx.db, 'Admin Four', a.id)).id;
  priya = (await user(ctx.db, 'Priya Presales', w.id)).id;
  raj = (await user(ctx.db, 'Raj Presales', w.id)).id;
  sam = (await user(ctx.db, 'Sam Sales', w.id)).id;
  tara = (await user(ctx.db, 'Tara Sales', w.id)).id;
});

const search = (as: string, q: Record<string, string | number>) =>
  ctx
    .as(as)
    .get(
      `/leads/search?${new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)])).toString()}`,
    );
const names = (r: { body: { items: Array<{ customerName: string }> } }) =>
  r.body.items.map((i) => i.customerName).sort();

describe('phone search', () => {
  beforeEach(async () => {
    await lead(ctx.db, { customerName: 'One', phone: '+91 98765 43210' });
    await lead(ctx.db, { customerName: 'Two', phone: '098765-43210' });
    await lead(ctx.db, {
      customerName: 'Three',
      phone: '022 4000 1000',
      alternatePhone: '(98765) 43210',
    });
    await lead(ctx.db, {
      customerName: 'Four',
      phone: '080-2233-4455',
      assignedToId: tara,
    });
  });

  it('finds every lead on a number however the number is typed', async () => {
    for (const q of [
      '9876543210',
      '+91 98765 43210',
      '+91-98765-43210',
      '098765 43210',
      '(+91) 98765.43210',
      '919876543210',
    ]) {
      const r = await search(admin, { q });
      expect([q, r.status, names(r)]).toEqual([
        q,
        200,
        ['One', 'Three', 'Two'],
      ]);
      expect(r.body.total).toBe(3);
    }
  });

  it('finds part of a number from 4 digits, and treats fewer as text', async () => {
    expect(names(await search(admin, { q: '43210' }))).toEqual([
      'One',
      'Three',
      'Two',
    ]);
    expect(names(await search(admin, { q: '2233-44' }))).toEqual(['Four']);
    expect((await search(admin, { q: '22' })).body.total).toBe(0);
  });

  it('pages the matches and keeps the same total on every page', async () => {
    const p1 = await search(admin, {
      q: '9876543210',
      pageSize: 2,
      page: 1,
      sort: 'customerName',
      dir: 'asc',
    });
    const p2 = await search(admin, {
      q: '9876543210',
      pageSize: 2,
      page: 2,
      sort: 'customerName',
      dir: 'asc',
    });
    expect([p1.body.total, p2.body.total]).toEqual([3, 3]);
    expect([...names(p1), ...names(p2)].sort()).toEqual([
      'One',
      'Three',
      'Two',
    ]);
    expect(
      p1.body.items.map((i: { customerName: string }) => i.customerName),
    ).toEqual(['One', 'Three']);
  });

  it('never returns, counts or hints at a lead the caller may not see', async () => {
    const r = await search(tara, { q: '9876543210' });
    expect(r.body).toMatchObject({ items: [], total: 0 });
    expect(r.body.facets.status).toEqual([]);
    expect(names(await search(tara, { q: '080 2233 4455' }))).toEqual(['Four']);
    expect((await search(tara, {})).body.total).toBe(1);
  });
});

describe('pre-sales involvement', () => {
  let a: string, b: string, legacy: string;
  beforeEach(async () => {
    // A: Priya worked it in pre-sales (assigned, a call that did not connect), then
    // qualified it to Sam; Sam called after qualification.
    a = (await lead(ctx.db, { customerName: 'Alpha Mills' })).id;
    expect(
      (
        await ctx
          .as(admin)
          .post('/lead-assignments', { leadId: a, assignedToId: priya })
      ).status,
    ).toBe(201);
    expect(
      (
        await ctx.as(priya).post(`/leads/${a}/activities`, {
          activityType: 'CALL',
          outcome: 'NOT_CONNECTED',
        })
      ).status,
    ).toBe(201);
    await completeBant(ctx.db, a);
    expect(
      (
        await ctx
          .as(priya)
          .patch(`/lead-assignments/${a}/qualify`, { salesUserId: sam })
      ).status,
    ).toBe(200);
    expect(
      (
        await ctx.as(sam).post(`/leads/${a}/activities`, {
          activityType: 'CALL',
          outcome: 'CONNECTED',
        })
      ).status,
    ).toBe(201);
    // B: assigned to Priya, reassigned to Raj, who logged a meeting; still in pre-sales.
    b = (await lead(ctx.db, { customerName: 'Beta Fabrics' })).id;
    await ctx
      .as(admin)
      .post('/lead-assignments', { leadId: b, assignedToId: priya });
    await ctx
      .as(admin)
      .post('/lead-assignments', { leadId: b, assignedToId: raj });
    await ctx.as(raj).post(`/leads/${b}/activities`, {
      activityType: 'MEETING',
      remarks: 'Visited the plant',
    });
    // An older lead whose assignment was recorded before the person was kept by id: only
    // its text names Priya, which is never turned into an identity.
    legacy = (
      await lead(ctx.db, {
        customerName: 'Legacy Co',
        status: 'PRE_SALES_ASSIGNED',
      })
    ).id;
    await ctx.db.leadTimeline.create({
      data: {
        leadId: legacy,
        action: 'PRE_SALES_ASSIGNED',
        remarks: 'Assigned to pre-sales: Priya Presales.',
        actorId: admin,
      },
    });
  });

  it('filters by who worked on the lead, past and present', async () => {
    expect(names(await search(admin, { presalesUserId: priya }))).toEqual([
      'Alpha Mills',
      'Beta Fabrics',
    ]);
    expect(names(await search(admin, { presalesUserId: raj }))).toEqual([
      'Beta Fabrics',
    ]);
    // Sam only sold it: he is its sales owner, not pre-sales
    expect(names(await search(admin, { presalesUserId: sam }))).toEqual([]);
    expect(names(await search(admin, { salesUserId: sam }))).toEqual([
      'Alpha Mills',
    ]);
    expect(
      names(await search(admin, { presalesUserId: `${priya},${raj}` })),
    ).toEqual(['Alpha Mills', 'Beta Fabrics']);
  });

  it('shows the pre-sales people, the current sales owner, the status and the last call on each row', async () => {
    const r = await search(admin, { sort: 'customerName', dir: 'asc' });
    const byName = Object.fromEntries(
      r.body.items.map((i: any) => [i.customerName, i]),
    );
    expect(byName['Alpha Mills']).toMatchObject({
      status: 'SALES_ASSIGNED',
      salesOwner: { id: sam, fullName: 'Sam Sales' },
      presales: [{ id: priya, fullName: 'Priya Presales' }],
      lastCallOutcome: 'CONNECTED',
    });
    expect(
      byName['Beta Fabrics'].presales.map((p: { id: string }) => p.id).sort(),
    ).toEqual([priya, raj].sort());
    expect(byName['Beta Fabrics']).toMatchObject({
      status: 'PRE_SALES_ASSIGNED',
      salesOwner: null,
      assignedTo: { id: raj },
    });
    expect(byName['Legacy Co'].presales).toEqual([]);
  });

  it('counts each person once per lead, and the counts match the filtered results', async () => {
    const r = await search(admin, {});
    const count = (id: string) =>
      r.body.facets.presales.find((p: { value: string }) => p.value === id)
        ?.count ?? 0;
    for (const id of [priya, raj, sam]) {
      expect(count(id)).toBe(
        (await search(admin, { presalesUserId: id })).body.total,
      );
    }
    expect(
      r.body.facets.presales.find((p: { value: string }) => p.value === priya)
        .person,
    ).toEqual({ id: priya, fullName: 'Priya Presales' });
    expect(r.body.facets.sales).toEqual([
      { value: sam, count: 1, person: { id: sam, fullName: 'Sam Sales' } },
    ]);
  });

  it("keeps the filter inside the caller's scope", async () => {
    // Tara works none of these: filtering by Priya shows her nothing, and no counts
    expect((await search(tara, { presalesUserId: priya })).body).toMatchObject({
      items: [],
      total: 0,
    });
    expect((await search(tara, {})).body.facets.presales).toEqual([]);
    // Raj sees B (his) but not A
    expect(names(await search(raj, { presalesUserId: priya }))).toEqual([
      'Beta Fabrics',
    ]);
  });

  it('pages the Pre-Sales view', async () => {
    const p = await search(admin, {
      presalesUserId: priya,
      pageSize: 1,
      page: 2,
      sort: 'customerName',
      dir: 'asc',
    });
    expect([p.body.total, names(p)]).toEqual([2, ['Beta Fabrics']]);
  });

  it('filters by the last call outcome (CNC) and by assignment state', async () => {
    expect(names(await search(admin, { lastCall: 'CNC' }))).toEqual([]); // A's latest call connected
    await ctx.as(raj).post(`/leads/${b}/activities`, {
      activityType: 'CALL',
      outcome: 'NOT_CONNECTED',
    });
    expect(names(await search(admin, { lastCall: 'CNC' }))).toEqual([
      'Beta Fabrics',
    ]);
    expect(names(await search(admin, { lastCall: 'NONE' }))).toEqual([
      'Legacy Co',
    ]);
    expect((await search(admin, { assignment: 'unassigned' })).body.total).toBe(
      1,
    );
    expect((await search(admin, { assignment: 'assigned' })).body.total).toBe(
      2,
    );
  });
});

describe('other filters', () => {
  it('status (several), received dates in India time, follow-ups, place, and validation', async () => {
    const s = await ctx.db.leadSource.create({ data: { name: 'IndiaMART' } });
    // 2026-10-01 00:30 IST is 2026-09-30 19:00 UTC: an IST-day filter must count it on 1 October
    await lead(ctx.db, {
      customerName: 'Early',
      createdAt: new Date('2026-09-30T19:00:00Z'),
      status: 'CONTACTED',
      sourceId: s.id,
      country: 'IN',
      state: 'Maharashtra',
      city: 'Pune',
    });
    await lead(ctx.db, {
      customerName: 'Late',
      createdAt: new Date('2026-10-02T10:00:00Z'),
      status: 'UNDERQUALIFIED',
    });
    const due = await lead(ctx.db, { customerName: 'Due', status: 'NEW' });
    await ctx.db.leadFollowup.create({
      data: {
        leadId: due.id,
        followupDate: new Date(Date.now() - 2 * 86400000),
      },
    });
    expect(
      names(
        await search(admin, {
          createdFrom: '2026-10-01',
          createdTo: '2026-10-01',
        }),
      ),
    ).toEqual(['Early']);
    expect(
      names(await search(admin, { status: 'CONTACTED,UNDERQUALIFIED' })),
    ).toEqual(['Early', 'Late']);
    expect(names(await search(admin, { followup: 'Overdue' }))).toEqual([
      'Due',
    ]);
    expect(
      names(
        await search(admin, {
          source: 'IndiaMART',
          state: 'Maharashtra',
          city: 'Pune',
          country: 'IN',
        }),
      ),
    ).toEqual(['Early']);
    expect(names(await search(admin, { country: 'NOT_SET' }))).toEqual([
      'Due',
      'Late',
    ]);
    for (const bad of [
      { status: 'NOPE' },
      { pageSize: 500 },
      { createdFrom: '1/10/2026' },
      { sort: 'phone' },
      { country: 'india' },
    ] as Array<Record<string, string | number>>) {
      expect([bad, (await search(admin, bad)).status]).toEqual([bad, 400]);
    }
  });
});
