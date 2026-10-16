/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest response bodies are loosely typed */
import { Ctx, reset, role, startApp, stopApp, user } from './harness';

// Duplicate-customer detection and safe creation on a real database.

let ctx: Ctx;
let admin: string, viewer: string;
const gst = (gstin: string, extra: object = {}) => ({
  gstin,
  legalName: 'Registered Name',
  addressLine1: '1 Mill Road',
  city: 'Pune',
  pincode: '411001',
  ...extra,
});

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', [
    'customers.view',
    'customers.create',
    'customers.gst.manage',
    'revenue.view.all',
  ]);
  const v = await role(ctx.db, 'VIEWER', [
    'customers.view',
    'revenue.view.all',
  ]);
  admin = (await user(ctx.db, 'Admin Two', a.id)).id;
  viewer = (await user(ctx.db, 'Vera Viewer', v.id)).id;
});

const check = (q: Record<string, string>) =>
  ctx
    .as(admin)
    .get(`/customers/duplicate-check?${new URLSearchParams(q).toString()}`);

describe('duplicate check', () => {
  it('finds the same GSTIN however it is typed, as an exact match', async () => {
    const c = await ctx.as(admin).post('/customers', {
      customerName: 'Sterling Pumps',
      gstRegistration: gst('27ABCDE1234F1Z5'),
    });
    expect(c.status).toBe(201);
    for (const typed of [
      '27ABCDE1234F1Z5',
      '27 abcde 1234 f1z5',
      '27-ABCDE-1234F-1Z5',
      '27.abcde.1234f.1z5',
    ]) {
      const r = await check({ gstin: typed });
      expect([typed, r.status]).toEqual([typed, 200]);
      expect(r.body.blocking).toEqual([
        expect.objectContaining({
          id: c.body.id,
          reasons: ['GSTIN', 'PAN'],
          strength: 'EXACT',
        }),
      ]);
    }
    // a half-typed GSTIN is a valid question that matches nothing
    expect((await check({ gstin: '27ABCDE12' })).body).toEqual({
      blocking: [],
      warnings: [],
    });
  });

  it('finds the same business in another state by the PAN its GSTIN carries', async () => {
    const c = await ctx.as(admin).post('/customers', {
      customerName: 'Sterling Pumps',
      gstRegistration: gst('27ABCDE1234F1Z5'),
    });
    const r = await check({
      customerName: 'Sterling Pumps Karnataka',
      gstin: '29ABCDE1234F1Z1',
    });
    expect(r.body.blocking).toEqual([
      expect.objectContaining({
        id: c.body.id,
        reasons: ['PAN'],
        strength: 'STRONG',
      }),
    ]);
    // ... and by PAN typed alone, although the customer has no PAN of its own
    expect(
      (await check({ panNumber: 'abcde1234f' })).body.blocking.map(
        (m: { id: string }) => m.id,
      ),
    ).toEqual([c.body.id]);
  });

  it('only warns about a shared phone number or email', async () => {
    await ctx.as(admin).post('/customers', {
      customerName: 'Shared Office One',
      phone: '+91 98765 43210',
      email: 'accounts@park.example',
    });
    const r = await check({
      customerName: 'Shared Office Two',
      phone: '098765-43210',
      email: 'Accounts@Park.example',
    });
    expect(r.body.blocking).toEqual([]);
    expect(r.body.warnings).toEqual([
      expect.objectContaining({
        reasons: ['PHONE', 'EMAIL'],
        strength: 'POSSIBLE',
      }),
    ]);
  });

  it('works without a GSTIN', async () => {
    await ctx.as(admin).post('/customers', { customerName: 'No GST Traders' });
    expect(
      (await check({ customerName: 'no gst  traders' })).body.blocking,
    ).toHaveLength(1);
  });
});

describe('creating a customer with its first GST registration', () => {
  it('creates both in one go, the registration as the default', async () => {
    const r = await ctx.as(admin).post('/customers', {
      customerName: 'Orbit Felt',
      panNumber: 'ABCDE1234F',
      gstRegistration: gst('27ABCDE1234F1Z5'),
    });
    expect(r.status).toBe(201);
    expect(r.body.gstRegistrations).toEqual([
      expect.objectContaining({
        gstin: '27ABCDE1234F1Z5',
        stateName: 'Maharashtra',
        isDefault: true,
        isActive: true,
      }),
    ]);
    const events = await ctx.db.customerEvent.findMany({
      where: { customerId: r.body.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(events.map((e) => [e.action, e.actorId])).toEqual([
      ['CUSTOMER_CREATED', admin],
      ['GST_ADDED', admin],
    ]);
  });

  it('refuses a GSTIN that is already registered, and creates nothing', async () => {
    await ctx.as(admin).post('/customers', {
      customerName: 'First Owner',
      gstRegistration: gst('27ABCDE1234F1Z5'),
    });
    const r = await ctx.as(admin).post('/customers', {
      customerName: 'Someone Else',
      gstRegistration: gst('27ABCDE1234F1Z5'),
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('DUPLICATE_GSTIN');
    expect(await ctx.db.customer.count()).toBe(1);
  });

  it('refuses a GSTIN that carries another PAN than the one given, and creates nothing', async () => {
    const r = await ctx.as(admin).post('/customers', {
      customerName: 'Mismatch Ltd',
      panNumber: 'ZZZZZ9999Z',
      gstRegistration: gst('27ABCDE1234F1Z5'),
    });
    expect(r.status).toBe(400);
    expect(await ctx.db.customer.count()).toBe(0);
  });

  it('lets exactly one of two simultaneous creations with the same GSTIN through', async () => {
    const [a, b] = await Promise.all([
      ctx.as(admin).post('/customers', {
        customerName: 'Race A',
        gstRegistration: gst('27ABCDE1234F1Z5'),
      }),
      ctx.as(admin).post('/customers', {
        customerName: 'Race B',
        gstRegistration: gst('27ABCDE1234F1Z5'),
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await ctx.db.customer.count()).toBe(1);
    expect(await ctx.db.customerGSTRegistration.count()).toBe(1);
  });

  it('needs customers.create', async () => {
    expect(
      (await ctx.as(viewer).post('/customers', { customerName: 'Nope' }))
        .status,
    ).toBe(403);
    expect(await ctx.db.customer.count()).toBe(0);
  });
});
