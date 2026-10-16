/* eslint-disable @typescript-eslint/no-unsafe-argument -- supertest bodies are loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../../src/app.module';

// Shared set-up for the integration tests: the whole application over HTTP, the real
// database client, a reset that empties the scratch database, and a seed of people,
// roles and permissions. See setup-env.js for the scratch-only safeguards.

export interface Ctx {
  app: INestApplication;
  db: PrismaClient;
  http: () => ReturnType<typeof request>;
  token: (userId: string) => string;
  as: (userId: string) => {
    get: (url: string) => request.Test;
    post: (url: string, body?: object) => request.Test;
    patch: (url: string, body?: object) => request.Test;
    del: (url: string) => request.Test;
  };
}

const tokens = new Map<string, string>();
let jwt: JwtService | undefined;

export async function startApp(): Promise<Ctx> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  const db = new PrismaClient();
  await assertScratch(db);
  jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const token = (userId: string) => {
    const t = tokens.get(userId);
    if (!t) throw new Error(`no token for ${userId}: seed the user first`);
    return t;
  };
  const http = () => request(app.getHttpServer());
  const as = (userId: string) => ({
    get: (url: string) => http().get(url).set('Authorization', `Bearer ${token(userId)}`),
    post: (url: string, body: object = {}) => http().post(url).set('Authorization', `Bearer ${token(userId)}`).send(body),
    patch: (url: string, body: object = {}) => http().patch(url).set('Authorization', `Bearer ${token(userId)}`).send(body),
    del: (url: string) => http().delete(url).set('Authorization', `Bearer ${token(userId)}`),
  });
  return { app, db, http, token, as };
}

export async function stopApp(ctx: Ctx | undefined) {
  if (!ctx) return;
  await ctx.app.close();
  await ctx.db.$disconnect();
}

async function assertScratch(db: PrismaClient) {
  const [row] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  if (!/^rev_[a-z0-9_]+$/.test(row.name)) throw new Error('refusing to run against a non-scratch database');
}

/** Empties every table (the scratch database only), keeping the schema. */
export async function reset(db: PrismaClient) {
  await assertScratch(db);
  const tables = await db.$queryRaw<Array<{ t: string }>>`
    SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // The deletion tombstones are append-only, TRUNCATE included: the trigger is switched off
  // around the reset (scratch database only; the tables belong to the test user there).
  await db.$transaction([
    db.$executeRawUnsafe(`ALTER TABLE "DataDeletionRecord" DISABLE TRIGGER USER`),
    db.$executeRawUnsafe(`TRUNCATE ${tables.map((r) => `"${r.t}"`).join(', ')} RESTART IDENTITY CASCADE`),
    db.$executeRawUnsafe(`ALTER TABLE "DataDeletionRecord" ENABLE TRIGGER USER`),
  ]);
  tokens.clear();
}

let seq = 0;
export const uid = (n?: number) => `00000000-0000-4000-8000-${String(n ?? ++seq + 1000).padStart(12, '0')}`;

/** Creates the permission codes and a role holding the given ones. */
export async function role(db: PrismaClient, name: string, codes: string[]) {
  const r = await db.role.upsert({ where: { name }, update: {}, create: { name } });
  for (const code of codes) {
    const p = await db.permission.upsert({ where: { code }, update: {}, create: { code, name: code, module: code.split('.')[0] } });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: r.id, permissionId: p.id } }, update: {}, create: { roleId: r.id, permissionId: p.id } });
  }
  return r;
}

/** A user of a role, with a login token carrying that role's permissions (as login does). */
export async function user(db: PrismaClient, fullName: string, roleId: string, extra: Partial<Prisma.UserUncheckedCreateInput> = {}) {
  const u = await db.user.create({
    data: { fullName, email: `${fullName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}.${++seq}@scratch.test`, passwordHash: 'scratch-no-login', roleId, ...extra },
  });
  const perms = await db.rolePermission.findMany({ where: { roleId }, include: { permission: true, role: true } });
  if (!jwt) throw new Error('start the app first');
  tokens.set(u.id, jwt.sign({ sub: u.id, email: u.email, role: perms[0]?.role.name ?? 'NONE', permissions: perms.map((p) => p.permission.code) }));
  return u;
}

export async function source(db: PrismaClient, name = 'Website') {
  return db.leadSource.upsert({ where: { name }, update: {}, create: { name } });
}

export async function lead(db: PrismaClient, data: Partial<Prisma.LeadUncheckedCreateInput> & { customerName: string }) {
  const s = data.sourceId ? null : await source(db);
  return db.lead.create({ data: { phone: '9876500000', sourceId: s?.id ?? data.sourceId!, ...data } });
}
