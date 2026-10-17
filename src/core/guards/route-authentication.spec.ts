/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- test doubles and framework internals are intentionally loosely typed */
import {
  INestApplication,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHmac } from 'crypto';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../database/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { IS_PUBLIC_KEY, PUBLIC_ROUTES } from '../decorators/public.decorator';
import { DataDeletionPurgeWorker } from '../../modules/revenueos/data-governance/data-deletion-purge.worker';
import { FinanceVisibilityGuard } from '../../modules/revenueos/record-scope/finance-visibility.guard';
import { PermissionsGuard } from './permissions.guard';

// Default-deny authentication, checked on the WHOLE application: the real AppModule with
// every module, the real global JwtAuthGuard, the real JWT strategy and PermissionsGuard.
// Only the database is replaced, by a stand-in that records every call and holds no data,
// so a request that is refused must leave it untouched.
//
// Every route the application registers is called without a token, with a malformed
// token, with an expired token and with a token signed by another key. Only the routes in
// PUBLIC_ROUTES may answer anything but 401. A new route is covered automatically: it
// fails here unless it is protected, or is added to PUBLIC_ROUTES on purpose.

// Routes behind PermissionsGuard that deliberately declare no permission.
const NO_PERMISSION_DECLARED = [
  // Retired: always answers 410 Gone, to any signed-in user.
  'POST /quotations/:id/convert',
];

const SAMPLE_ID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------- database stand-in

const calls: string[] = [];

function resultFor(operation: string): unknown {
  if (operation === 'findMany' || operation === 'groupBy') return [];
  if (operation === 'count') return 0;
  if (operation === 'aggregate') return { _sum: {}, _count: {} };
  return null;
}

function delegate(model: string) {
  return new Proxy(
    {},
    {
      get: (_target, operation) =>
        typeof operation !== 'string'
          ? undefined
          : () => {
              calls.push(`${model}.${operation}`);
              return Promise.resolve(resultFor(operation));
            },
    },
  );
}

function prismaStandIn() {
  const client: Record<string, unknown> = {};

  for (const model of Prisma.dmmf.datamodel.models) {
    const name = model.name.charAt(0).toLowerCase() + model.name.slice(1);
    client[name] = delegate(name);
  }

  for (const raw of [
    '$queryRaw',
    '$executeRaw',
    '$queryRawUnsafe',
    '$executeRawUnsafe',
  ]) {
    client[raw] = () => {
      calls.push(raw);
      return Promise.resolve([]);
    };
  }

  client.$transaction = (arg: unknown) => {
    calls.push('$transaction');
    return typeof arg === 'function'
      ? (arg as (tx: unknown) => unknown)(client)
      : Promise.all(arg as unknown[]);
  };
  client.$connect = () => Promise.resolve();
  client.$disconnect = () => Promise.resolve();

  return client;
}

// ---------------------------------------------------------------- routes

interface RouteEntry {
  key: string; // "GET /leads/:id"
  method: string;
  path: string;
}

function routeKey(method: string, path: string) {
  return `${method.toUpperCase()} ${path}`;
}

function samplePath(path: string) {
  return path.replace(/:[A-Za-z0-9_]+/g, SAMPLE_ID);
}

function joinPath(...parts: Array<string | undefined>) {
  const joined = parts
    .filter((part): part is string => !!part && part !== '/')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return `/${joined}`;
}

// What the HTTP server will actually answer: the routes in the Express router.
function registeredRoutes(app: INestApplication): RouteEntry[] {
  const express = app.getHttpAdapter().getInstance();
  const stack: any[] = express.router.stack;
  const routes: RouteEntry[] = [];

  for (const layer of stack) {
    if (!layer.route) continue;

    for (const method of Object.keys(layer.route.methods)) {
      if (method === '_all') continue;
      routes.push({
        key: routeKey(method, layer.route.path),
        method,
        path: layer.route.path,
      });
    }
  }

  return routes;
}

interface Handler {
  key: string;
  controller: any;
  handler: (...args: unknown[]) => unknown;
}

// Every route handler of every controller registered in the application.
function controllerHandlers(app: INestApplication): Handler[] {
  const handlers: Handler[] = [];

  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as any;
      if (!controller?.prototype) continue;

      const base: string | string[] =
        Reflect.getMetadata(PATH_METADATA, controller) ?? '';

      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;

        const method: RequestMethod | undefined = Reflect.getMetadata(
          METHOD_METADATA,
          handler,
        );
        if (method === undefined) continue;

        const paths: string | string[] =
          Reflect.getMetadata(PATH_METADATA, handler) ?? '';

        for (const b of [base].flat()) {
          for (const p of [paths].flat()) {
            handlers.push({
              key: routeKey(RequestMethod[method], joinPath(b, p)),
              controller,
              handler,
            });
          }
        }
      }
    }
  }

  return handlers;
}

// ---------------------------------------------------------------- tokens

function signer() {
  // The same key the application's JWT strategy was built with.
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  });
}

function token(permissions: unknown, options: { expired?: boolean } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    sub: 'route-authentication-spec-user',
    email: 'route-authentication-spec@example.invalid',
    role: 'TEST',
    permissions,
    iat: now - 7200,
    exp: options.expired ? now - 3600 : now + 3600,
  };

  return signer().sign(payload);
}

function tokenSignedWithAnotherKey() {
  return new JwtService({ secret: 'not-the-application-key' }).sign(
    {
      sub: 'route-authentication-spec-user',
      permissions: ['leads.view'],
    },
    { expiresIn: '1h' },
  );
}

function unsignedToken() {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: 'route-authentication-spec-user',
    permissions: ['leads.view'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.`;
}

// ---------------------------------------------------------------- the application

describe('Default-deny authentication across every route', () => {
  let app: INestApplication;
  let routes: RouteEntry[];
  let handlers: Handler[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaStandIn())
      // No background purge runs during the test.
      .overrideProvider(DataDeletionPurgeWorker)
      .useValue({})
      .compile();

    // rawBody as in main.ts (WhatsApp webhook signatures are checked on the raw body).
    app = moduleRef.createNestApplication({ logger: false, rawBody: true });
    // As in main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    routes = registeredRoutes(app);
    handlers = controllerHandlers(app);
  }, 180000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  function send(route: RouteEntry, authorization?: string) {
    const http = request(app.getHttpServer());
    const url = samplePath(route.path);
    const req = (http as any)[route.method](url);

    if (authorization !== undefined) req.set('Authorization', authorization);

    return route.method === 'get' ? req : req.send({});
  }

  const isPublic = (route: RouteEntry) =>
    (PUBLIC_ROUTES as readonly string[]).includes(route.key);

  describe('route inventory', () => {
    it('finds every route the application serves', () => {
      // The router and the controllers agree, so no route escapes the checks below.
      expect(routes.length).toBe(handlers.length);
      expect(routes.length).toBeGreaterThan(300);
      expect(new Set(routes.map((r) => r.key))).toEqual(
        new Set(handlers.map((h) => h.key)),
      );

      for (const key of [
        'GET /leads',
        'DELETE /leads/:id',
        'GET /data-deletions',
        'POST /data-deletions/:id/purge',
        'GET /users',
        'POST /role-permissions',
        'POST /journal',
        ...PUBLIC_ROUTES,
      ]) {
        expect(routes.map((r) => r.key)).toContain(key);
      }
    });

    it('marks exactly the allow-listed routes @Public(), and only on their handlers', () => {
      const marked = handlers
        .filter((h) => Reflect.getMetadata(IS_PUBLIC_KEY, h.handler) === true)
        .map((h) => h.key)
        .sort();

      expect(marked).toEqual([...PUBLIC_ROUTES].sort());

      const classLevel = handlers
        .filter((h) => Reflect.getMetadata(IS_PUBLIC_KEY, h.controller))
        .map((h) => h.controller.name);

      expect(classLevel).toEqual([]);
    });

    it('has every route behind PermissionsGuard declare a permission, except the known ones', () => {
      const undeclared = handlers
        .filter((h) => {
          const guards = [
            ...(Reflect.getMetadata(GUARDS_METADATA, h.controller) ?? []),
            ...(Reflect.getMetadata(GUARDS_METADATA, h.handler) ?? []),
          ];

          if (!guards.includes(PermissionsGuard)) return false;
          // Finance visibility is a declared requirement too (finance.view.all, or
          // revenue.view.all): FinanceVisibilityGuard checks it instead of a code.
          if (guards.includes(FinanceVisibilityGuard)) return false;

          const declared = [
            ...(Reflect.getMetadata(PERMISSIONS_KEY, h.controller) ?? []),
            ...(Reflect.getMetadata(PERMISSIONS_KEY, h.handler) ?? []),
          ];

          return declared.length === 0;
        })
        .map((h) => h.key)
        .sort();

      expect(undeclared).toEqual([...NO_PERMISSION_DECLARED].sort());
    });
  });

  describe('a request without a valid token', () => {
    const variants: Array<[string, () => string | undefined]> = [
      ['no Authorization header', () => undefined],
      ['an empty bearer token', () => 'Bearer '],
      ['a malformed token', () => 'Bearer not-a-jwt'],
      ['a token in the wrong scheme', () => `Basic ${token(['leads.view'])}`],
      [
        'an expired token',
        () => `Bearer ${token(['leads.view'], { expired: true })}`,
      ],
      [
        'a token signed with another key',
        () => `Bearer ${tokenSignedWithAnotherKey()}`,
      ],
      ['an unsigned token (alg none)', () => `Bearer ${unsignedToken()}`],
    ];

    it.each(variants)(
      'is refused with 401 on every non-public route: %s',
      async (_label, authorization) => {
        const leaked: string[] = [];

        for (const route of routes.filter((r) => !isPublic(r))) {
          calls.length = 0;
          const res = await send(route, authorization());

          if (res.status !== 401 || calls.length > 0) {
            leaked.push(
              `${route.key} -> ${res.status}${calls.length ? ` (reached ${calls.join(', ')})` : ''}`,
            );
          }
        }

        expect(leaked).toEqual([]);
      },
      120000,
    );

    it('is answered only by the allow-listed routes', async () => {
      const answered: string[] = [];

      for (const route of routes) {
        const res = await send(route);
        if (res.status !== 401) answered.push(route.key);
      }

      expect(answered.sort()).toEqual([...PUBLIC_ROUTES].sort());
    }, 120000);

    it('does not accept the token from the query string', async () => {
      const res = await request(app.getHttpServer()).get(
        `/leads?access_token=${token(['leads.view'])}`,
      );

      expect(res.status).toBe(401);
    });
  });

  describe('the public routes keep their behaviour', () => {
    it('POST /auth/login reaches the login check (unknown user: 401 Invalid credentials)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.invalid', password: 'wrong-password' });

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid credentials');
      expect(calls).toContain('user.findUnique');
    });

    it('POST /auth/login still validates its body (400)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(calls).toEqual([]);
    });

    it('POST /webhooks/:platform reaches the connector lookup without a token', async () => {
      const res = await request(app.getHttpServer())
        .post('/webhooks/unknown-platform')
        .send({ customerName: 'x' });

      // Unchanged behaviour: a platform without a Connector is an error.
      expect(res.status).toBe(500);
      expect(calls).toEqual(['connector.findFirst']);
    });

    describe('POST /whatsapp/webhook (no login token; Meta signature required)', () => {
      const SECRET = 'route-authentication-spec-app-secret';
      const BODY = JSON.stringify({ entry: [] });
      const sign = (body: string, key = SECRET) =>
        `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;
      const deliver = (signature?: string) => {
        const req = request(app.getHttpServer())
          .post('/whatsapp/webhook')
          .set('Content-Type', 'application/json');
        if (signature) req.set('X-Hub-Signature-256', signature);
        return req.send(BODY);
      };
      let saved: string | undefined;

      beforeAll(() => {
        saved = process.env.WHATSAPP_APP_SECRET;
      });
      afterAll(() => {
        if (saved === undefined) delete process.env.WHATSAPP_APP_SECRET;
        else process.env.WHATSAPP_APP_SECRET = saved;
      });

      it('accepts a correctly signed delivery without a token', async () => {
        process.env.WHATSAPP_APP_SECRET = SECRET;
        const res = await deliver(sign(BODY));

        expect(res.status).toBe(201);
        expect(res.body).toEqual({ message: 'No incoming message' });
      });

      it('refuses an unsigned or wrongly signed delivery (401)', async () => {
        process.env.WHATSAPP_APP_SECRET = SECRET;

        expect((await deliver()).status).toBe(401);
        expect((await deliver(sign(BODY, 'another-key'))).status).toBe(401);
        expect(calls).toEqual([]);
      });

      it('refuses every delivery while no secret is configured (503)', async () => {
        delete process.env.WHATSAPP_APP_SECRET;

        expect((await deliver(sign(BODY))).status).toBe(503);
        expect(calls).toEqual([]);
      });
    });

    it('GET /whatsapp/webhook (the verification handshake) is not public', async () => {
      const res = await request(app.getHttpServer()).get(
        '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1',
      );

      expect(res.status).toBe(401);
    });
  });

  describe('a valid token', () => {
    const auth = (permissions: unknown) => `Bearer ${token(permissions)}`;

    it('reaches a route that needs only a login', async () => {
      const res = await request(app.getHttpServer())
        .get('/lead-sources')
        .set('Authorization', auth([]));

      expect(res.status).toBe(200);
      expect(calls).toEqual(['leadSource.findMany']);
    });

    it('still meets the route permission check: 403 without the permission', async () => {
      const res = await request(app.getHttpServer())
        .get('/leads')
        .set('Authorization', auth(['opportunities.view']));

      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    });

    it('passes the permission check with the permission', async () => {
      const res = await request(app.getHttpServer())
        .get('/leads')
        .set('Authorization', auth(['leads.view']));

      expect(res.status).toBe(200);
      expect(calls).toEqual(['lead.findMany']);
    });

    it('is refused when its permissions are a string rather than a list', async () => {
      const res = await request(app.getHttpServer())
        .get('/leads')
        .set('Authorization', auth('leads.view'));

      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    });

    it('is refused when it carries no permissions at all', async () => {
      const res = await request(app.getHttpServer())
        .get('/leads')
        .set('Authorization', auth(undefined));

      expect(res.status).toBe(403);
      expect(calls).toEqual([]);
    });

    describe('M3 deletion and recovery keep their permission checks', () => {
      const cases: Array<[string, string, string, string[]]> = [
        [
          'delete',
          'delete',
          `/leads/${SAMPLE_ID}`,
          ['leads.view', 'customers.delete'],
        ],
        [
          'preview',
          'get',
          `/customers/${SAMPLE_ID}/deletion-preview`,
          ['leads.delete'],
        ],
        [
          'list',
          'get',
          '/data-deletions',
          ['governance.deletions.restore', 'governance.deletions.purge'],
        ],
        [
          'restore',
          'post',
          `/data-deletions/${SAMPLE_ID}/restore`,
          ['governance.deletions.restore'],
        ],
        [
          'purge',
          'post',
          `/data-deletions/${SAMPLE_ID}/purge`,
          ['governance.deletions.purge'],
        ],
        [
          'purge (view only)',
          'post',
          `/data-deletions/${SAMPLE_ID}/purge`,
          ['governance.deletions.view'],
        ],
      ];

      it.each(cases)(
        '%s is 403 without the required permissions',
        async (_label, method, url, permissions) => {
          const res = await (request(app.getHttpServer()) as any)
            [method](url)
            .set('Authorization', auth(permissions))
            .send({});

          expect(res.status).toBe(403);
          expect(calls).toEqual([]);
        },
      );

      it('the deletion log is reachable with governance.deletions.view', async () => {
        const res = await request(app.getHttpServer())
          .get('/data-deletions')
          .set('Authorization', auth(['governance.deletions.view']));

        expect(res.status).toBe(200);
        expect(calls).toEqual(['dataDeletionRecord.findMany']);
      });
    });
  });
});
