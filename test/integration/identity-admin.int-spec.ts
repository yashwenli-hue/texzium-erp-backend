/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- supertest response bodies are loosely typed */
import * as bcrypt from 'bcrypt';

import { Ctx, reset, role, startApp, stopApp, user } from './harness';

// Access administration on a real database: role permission changes, user roles and
// status, the safeguards (hold what you grant, sensitive grants, no lockout, no self
// change) and the audit trail.

let ctx: Ctx;
const ADMIN_CODES = [
  'roles.view',
  'roles.create',
  'roles.permissions.assign',
  'roles.permissions.revoke',
  'permissions.manage',
  'users.view',
  'users.create',
  'users.role.assign',
  'users.status.manage',
  'leads.view',
  'content.view',
  'revenue.view.all',
];
let admin: string,
  delegate: string,
  sam: string,
  salesRole: string,
  adminRole: string;
const PASSWORD = 'scratch-only-password-1';

beforeAll(async () => {
  ctx = await startApp();
});
afterAll(async () => stopApp(ctx));
beforeEach(async () => {
  await reset(ctx.db);
  const a = await role(ctx.db, 'SUPER_ADMIN', ADMIN_CODES);
  adminRole = a.id;
  // A delegate can manage users' roles but holds only a few permissions itself.
  const d = await role(ctx.db, 'ACCESS_DELEGATE', [
    'roles.view',
    'roles.permissions.assign',
    'users.view',
    'users.role.assign',
    'leads.view',
  ]);
  const s = await role(ctx.db, 'SALES', ['leads.view']);
  salesRole = s.id;
  admin = (await user(ctx.db, 'Admin Five', a.id)).id;
  delegate = (await user(ctx.db, 'Dee Delegate', d.id)).id;
  sam = (
    await user(ctx.db, 'Sam Sales', s.id, {
      passwordHash: await bcrypt.hash(PASSWORD, 4),
    })
  ).id;
});

const codesOf = async (roleId: string) =>
  (
    await ctx.db.rolePermission.findMany({
      where: { roleId },
      include: { permission: true },
    })
  )
    .map((rp) => rp.permission.code)
    .sort();
const audit = (action: string) =>
  ctx.db.auditLog.findMany({
    where: { action },
    orderBy: { createdAt: 'asc' },
  });

describe("changing a role's permissions", () => {
  it('grants and revokes in one audited change, and a repeat changes nothing', async () => {
    const r = await ctx.as(admin).patch(`/roles/${salesRole}/permissions`, {
      grant: ['content.view'],
      revoke: ['leads.view'],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      granted: ['content.view'],
      revoked: ['leads.view'],
    });
    expect(await codesOf(salesRole)).toEqual(['content.view']);
    expect(
      (await audit('ROLE_PERMISSION_ASSIGNED')).map((e) => [
        e.userId,
        (e.newData as any).permissionCode,
      ]),
    ).toEqual([[admin, 'content.view']]);
    expect(
      (await audit('ROLE_PERMISSION_REVOKED')).map((e) => [
        e.userId,
        (e.newData as any).permissionCode,
      ]),
    ).toEqual([[admin, 'leads.view']]);
    const again = await ctx.as(admin).patch(`/roles/${salesRole}/permissions`, {
      grant: ['content.view'],
      revoke: ['leads.view'],
    });
    expect(again.body).toMatchObject({ granted: [], revoked: [] });
    expect(await ctx.db.auditLog.count()).toBe(2);
  });

  it('asks for an explicit acknowledgement before granting a sensitive permission', async () => {
    const r = await ctx.as(admin).patch(`/roles/${salesRole}/permissions`, {
      grant: ['revenue.view.all', 'content.view'],
    });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({
      code: 'SENSITIVE_GRANT_NOT_ACKNOWLEDGED',
      sensitive: ['revenue.view.all'],
    });
    expect(await codesOf(salesRole)).toEqual(['leads.view']);
    const ok = await ctx.as(admin).patch(`/roles/${salesRole}/permissions`, {
      grant: ['revenue.view.all'],
      acknowledgeSensitive: true,
    });
    expect(ok.status).toBe(200);
  });

  it('never hands out or takes away what the caller does not hold, and needs the right to revoke', async () => {
    expect(
      (
        await ctx
          .as(delegate)
          .patch(`/roles/${salesRole}/permissions`, { grant: ['content.view'] })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx
          .as(delegate)
          .patch(`/roles/${salesRole}/permissions`, { revoke: ['leads.view'] })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx
          .as(sam)
          .patch(`/roles/${salesRole}/permissions`, { grant: ['leads.view'] })
      ).status,
    ).toBe(403);
    expect(await codesOf(salesRole)).toEqual(['leads.view']);
  });

  it('refuses a change that would leave nobody able to administer access', async () => {
    const d = await ctx.db.role.findUniqueOrThrow({
      where: { name: 'ACCESS_DELEGATE' },
    });
    await ctx.db.rolePermission.deleteMany({
      where: { roleId: d.id, permission: { code: 'roles.permissions.assign' } },
    });
    const r = await ctx.as(admin).patch(`/roles/${adminRole}/permissions`, {
      revoke: ['roles.permissions.assign'],
    });
    expect(r.status).toBe(409);
    expect(await codesOf(adminRole)).toContain('roles.permissions.assign');
    expect(await ctx.db.auditLog.count()).toBe(0);
  });

  it('rejects unknown codes and contradictory requests', async () => {
    // nobody holds a code that does not exist, so it is refused before it is looked up
    expect(
      (
        await ctx
          .as(admin)
          .patch(`/roles/${salesRole}/permissions`, { grant: ['leads.fly'] })
      ).status,
    ).toBe(403);
    expect(
      (
        await ctx.as(admin).patch(`/roles/${salesRole}/permissions`, {
          grant: ['leads.view'],
          revoke: ['leads.view'],
        })
      ).status,
    ).toBe(400);
    expect(
      (await ctx.as(admin).patch(`/roles/${salesRole}/permissions`, {})).status,
    ).toBe(400);
  });

  it('lists roles with their codes and user counts', async () => {
    const r = await ctx.as(admin).get('/roles');
    const sales = r.body.find((x: { name: string }) => x.name === 'SALES');
    expect(sales).toMatchObject({
      userCount: 1,
      permissions: [{ permission: { code: 'leads.view' } }],
    });
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|email/);
  });
});

describe("a user's role and status", () => {
  it("moves a user to another role, audited, but never the caller's own", async () => {
    const r = await ctx
      .as(admin)
      .patch(`/users/${sam}/role`, { roleId: adminRole });
    expect(r.status).toBe(200);
    expect(r.body.role.name).toBe('SUPER_ADMIN');
    expect(r.body.passwordHash).toBeUndefined();
    expect((await audit('USER_ROLE_CHANGED'))[0].newData).toMatchObject({
      fromRoleName: 'SALES',
      toRoleName: 'SUPER_ADMIN',
    });
    expect(
      (await ctx.as(admin).patch(`/users/${admin}/role`, { roleId: salesRole }))
        .status,
    ).toBe(400);
  });

  it('does not let a delegate raise anyone above what it holds itself', async () => {
    expect(
      (
        await ctx
          .as(delegate)
          .patch(`/users/${sam}/role`, { roleId: adminRole })
      ).status,
    ).toBe(403);
    expect(
      (await ctx.db.user.findUniqueOrThrow({ where: { id: sam } })).roleId,
    ).toBe(salesRole);
  });

  it('a suspended user can no longer sign in; reactivated, they can', async () => {
    const email = (await ctx.db.user.findUniqueOrThrow({ where: { id: sam } }))
      .email;
    expect(
      (await ctx.http().post('/auth/login').send({ email, password: PASSWORD }))
        .status,
    ).toBe(201);
    expect(
      (
        await ctx.as(admin).patch(`/users/${sam}/status`, {
          status: 'SUSPENDED',
          reason: 'On leave',
        })
      ).status,
    ).toBe(200);
    const refused = await ctx
      .http()
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    expect(refused.status).toBe(401);
    // a wrong password still gets the generic answer
    expect(
      (await ctx.http().post('/auth/login').send({ email, password: 'wrong' }))
        .body.message,
    ).toBe('Invalid credentials');
    expect((await audit('USER_STATUS_CHANGED'))[0].newData).toMatchObject({
      from: 'ACTIVE',
      to: 'SUSPENDED',
      reason: 'On leave',
    });
    expect(
      (await ctx.as(admin).patch(`/users/${sam}/status`, { status: 'ACTIVE' }))
        .status,
    ).toBe(200);
    expect(
      (await ctx.http().post('/auth/login').send({ email, password: PASSWORD }))
        .status,
    ).toBe(201);
  });

  it("refuses changing one's own status and deactivating the last administrator", async () => {
    expect(
      (
        await ctx
          .as(admin)
          .patch(`/users/${admin}/status`, { status: 'INACTIVE' })
      ).status,
    ).toBe(400);
    // the delegate is the only other person holding roles.permissions.assign: take it away
    // from them first, then the admin (moved by... nobody else) is the last one
    await ctx.db.user.update({
      where: { id: delegate },
      data: { status: 'INACTIVE' },
    });
    const second = (await user(ctx.db, 'Second Admin', adminRole)).id;
    expect(
      (
        await ctx
          .as(second)
          .patch(`/users/${admin}/status`, { status: 'INACTIVE' })
      ).status,
    ).toBe(200);
    expect(
      (
        await ctx
          .as(admin)
          .patch(`/users/${second}/status`, { status: 'INACTIVE' })
      ).status,
    ).toBe(409);
  });
});

describe('the access audit trail', () => {
  it('lists who changed what, newest first, to people who may view roles', async () => {
    await ctx
      .as(admin)
      .patch(`/roles/${salesRole}/permissions`, { grant: ['content.view'] });
    await ctx.as(admin).patch(`/users/${sam}/status`, { status: 'INACTIVE' });
    const r = await ctx.as(admin).get('/identity-audit?limit=10');
    expect(r.status).toBe(200);
    expect(r.body.map((e: { action: string }) => e.action)).toEqual([
      'USER_STATUS_CHANGED',
      'ROLE_PERMISSION_ASSIGNED',
    ]);
    expect(r.body[0].user).toEqual({ id: admin, fullName: 'Admin Five' });
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|scratch-no-login/);
    // Sam may not view roles. (Being inactive now does not end a login he already has:
    // that token works until it expires - one day - as the handover notes.)
    expect((await ctx.as(sam).get('/identity-audit')).status).toBe(403);
  });
});
