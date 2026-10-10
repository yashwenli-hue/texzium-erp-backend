/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- test doubles are intentionally loosely typed */
import {
  INestApplication,
  LoggerService,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import * as http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { inspect } from 'util';

import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PrismaService } from '../database/prisma.service';
import { WhatsAppModule } from './whatsapp.module';

// The WhatsApp API through real HTTP: real global JwtAuthGuard and JWT strategy, real
// PermissionsGuard, signature guard, redaction interceptor and service. The database is
// a recording double and the Graph API is a local stand-in server: nothing here can
// reach Meta. Every log line the application writes is captured, so the tests can prove
// that the access token never appears in a response, an error or a log.

const ACCESS_TOKEN = 'SENTINEL-ACCESS-TOKEN-7f3a9c';
const WEBHOOK_TOKEN = 'SENTINEL-VERIFY-TOKEN-51d2e8';
const APP_SECRET = 'whatsapp-access-spec-app-secret';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const CONFIG_ID = '00000000-0000-4000-8000-0000000000c1';

const CONFIG_ROW = {
  id: CONFIG_ID,
  companyName: 'Texzium',
  whatsappNumber: '+910000000000',
  defaultSenderName: 'Texzium',
  phoneNumberId: '1234567890',
  accessToken: ACCESS_TOKEN,
  businessAccount: '9876543210',
  webhookToken: WEBHOOK_TOKEN,
  isActive: true,
  createdAt: new Date('2026-06-25T00:00:00Z'),
  updatedAt: new Date('2026-06-25T00:00:00Z'),
};

// ------------------------------------------------------------- log capture

class CapturingLogger implements LoggerService {
  lines: string[] = [];
  private keep(args: unknown[]) {
    this.lines.push(args.map((a) => inspect(a, { depth: 8 })).join(' '));
  }
  log(...args: unknown[]) {
    this.keep(args);
  }
  error(...args: unknown[]) {
    this.keep(args);
  }
  warn(...args: unknown[]) {
    this.keep(args);
  }
  debug(...args: unknown[]) {
    this.keep(args);
  }
  verbose(...args: unknown[]) {
    this.keep(args);
  }
  fatal(...args: unknown[]) {
    this.keep(args);
  }
}

// ------------------------------------------------------------- Graph API stand-in

type GraphMode = 'ok' | 'reject' | 'echo-token';

interface GraphRequest {
  url: string;
  authorization?: string;
  body: any;
}

function startGraphStandIn() {
  const state = { mode: 'ok' as GraphMode, requests: [] as GraphRequest[] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const authorization = req.headers.authorization;
      state.requests.push({
        url: req.url ?? '',
        authorization,
        body: JSON.parse(raw || '{}'),
      });
      res.setHeader('Content-Type', 'application/json');
      if (state.mode === 'ok') {
        res.end(JSON.stringify({ messages: [{ id: 'wamid.TEST-1' }] }));
      } else if (state.mode === 'reject') {
        res.statusCode = 401;
        res.end(
          JSON.stringify({
            error: { message: 'Invalid OAuth access token.', code: 190 },
          }),
        );
      } else {
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            error: {
              message: `Bad token ${authorization?.replace('Bearer ', '')} (Bearer ${ACCESS_TOKEN})`,
            },
          }),
        );
      }
    });
  });

  return { server, state };
}

// ------------------------------------------------------------- database double

function prismaDouble() {
  const db: any = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: ACTOR }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    whatsAppConfig: {
      findMany: jest.fn(({ where }: any = {}) =>
        Promise.resolve(
          where?.webhookToken
            ? [{ webhookToken: WEBHOOK_TOKEN }]
            : [CONFIG_ROW, { ...CONFIG_ROW, id: 'c2', webhookToken: null }],
        ),
      ),
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(where?.id === CONFIG_ID ? CONFIG_ROW : null),
      ),
      findUnique: jest.fn(({ where }: any) =>
        Promise.resolve(where?.id === CONFIG_ID ? CONFIG_ROW : null),
      ),
      create: jest.fn(({ data }: any) =>
        Promise.resolve({ ...CONFIG_ROW, ...data, id: 'c-new' }),
      ),
      update: jest.fn(({ data }: any) =>
        Promise.resolve({ ...CONFIG_ROW, ...data }),
      ),
    },
    whatsAppBotConfig: {
      create: jest.fn(({ data }: any) =>
        Promise.resolve({ id: 'b1', ...data }),
      ),
    },
    whatsAppDepartmentRoute: {
      create: jest.fn(({ data }: any) =>
        Promise.resolve({ id: 'r1', ...data }),
      ),
    },
  };
  db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));
  return db;
}

function dbCalls(db: any): number {
  let n = 0;
  for (const model of Object.values(db)) {
    if (typeof model === 'function') continue;
    for (const fn of Object.values(model as object)) {
      n += (fn as jest.Mock).mock.calls.length;
    }
  }
  return n;
}

function token(permissions: string[]) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: ACTOR, email: 'actor@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

const VALID_CONFIG = {
  companyName: 'Texzium',
  whatsappNumber: '+910000000000',
  phoneNumberId: '1234567890',
  accessToken: ACCESS_TOKEN,
  businessAccount: '9876543210',
  webhookToken: WEBHOOK_TOKEN,
};

interface Route {
  name: string;
  method: 'get' | 'post' | 'patch';
  url: string;
  needs: string;
  body?: object;
}

const ROUTES: Route[] = [
  {
    name: 'list configurations',
    method: 'get',
    url: '/whatsapp/configs',
    needs: 'whatsapp.config.view',
  },
  {
    name: 'create a configuration',
    method: 'post',
    url: '/whatsapp/config',
    needs: 'whatsapp.config.manage',
    body: VALID_CONFIG,
  },
  {
    name: 'update a configuration',
    method: 'patch',
    url: `/whatsapp/configs/${CONFIG_ID}`,
    needs: 'whatsapp.config.manage',
    body: { companyName: 'Texzium Ltd' },
  },
  {
    name: 'create a bot configuration',
    method: 'post',
    url: '/whatsapp/bot-config',
    needs: 'whatsapp.config.manage',
    body: {
      whatsappConfigId: CONFIG_ID,
      welcomeMessage: 'Hi',
      unknownUserMessage: 'Name?',
    },
  },
  {
    name: 'create a department route',
    method: 'post',
    url: '/whatsapp/department-route',
    needs: 'whatsapp.config.manage',
    body: {
      botConfigId: 'b1',
      optionNumber: 1,
      departmentName: 'Sales',
      routeType: 'SALES',
    },
  },
  {
    name: 'send a message',
    method: 'post',
    url: '/whatsapp/send',
    needs: 'whatsapp.messages.send',
    body: { configId: CONFIG_ID, to: '+910000000001', message: 'Hello' },
  },
];
const ALL = [
  'whatsapp.config.view',
  'whatsapp.config.manage',
  'whatsapp.messages.send',
];

describe('WhatsApp API: authorization, secrets and webhook signature', () => {
  let app: INestApplication;
  let db: any;
  let logs: CapturingLogger;
  let graph: ReturnType<typeof startGraphStandIn>;
  const savedEnv = { ...process.env };

  beforeAll(async () => {
    graph = startGraphStandIn();
    await new Promise<void>((r) => graph.server.listen(0, '127.0.0.1', r));
    const port = (graph.server.address() as AddressInfo).port;
    process.env.WHATSAPP_GRAPH_BASE_URL = `http://127.0.0.1:${port}/v20.0`;
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    db = prismaDouble();
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, WhatsAppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();

    logs = new CapturingLogger();
    app = moduleRef.createNestApplication({ logger: logs, rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((r) => graph.server.close(r));
    process.env = savedEnv;
  });

  beforeEach(() => {
    const fresh = prismaDouble();
    for (const key of Object.keys(fresh)) db[key] = fresh[key];
    graph.state.mode = 'ok';
    graph.state.requests = [];
  });

  const send = (route: Route, permissions?: string[], body = route.body) => {
    const req = (request(app.getHttpServer()) as any)[route.method](route.url);
    if (permissions) req.set('Authorization', `Bearer ${token(permissions)}`);
    return body ? req.send(body) : req;
  };
  const noSecret = (value: unknown) => {
    const text = JSON.stringify(value);
    expect(text).not.toContain(ACCESS_TOKEN);
    expect(text).not.toContain(WEBHOOK_TOKEN);
  };

  describe.each(ROUTES)('$name ($method $url)', (route) => {
    it('is 401 without a token, and reaches nothing', async () => {
      expect((await send(route)).status).toBe(401);
      expect(dbCalls(db)).toBe(0);
      expect(graph.state.requests).toHaveLength(0);
    });

    it(`is 403 with every other WhatsApp permission but ${route.needs}`, async () => {
      const res = await send(
        route,
        ALL.filter((p) => p !== route.needs),
      );
      expect(res.status).toBe(403);
      expect(dbCalls(db)).toBe(0);
      expect(graph.state.requests).toHaveLength(0);
    });

    it(`succeeds with ${route.needs}, and the response holds no secret`, async () => {
      const res = await send(route, [route.needs]);
      expect(res.status).toBe(
        route.method === 'get' ? 200 : route.method === 'patch' ? 200 : 201,
      );
      noSecret(res.body);
    });
  });

  describe('configuration responses', () => {
    it('lists configurations with "is set" flags instead of the tokens', async () => {
      const res = await send(ROUTES[0], ['whatsapp.config.view']);

      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toEqual({
        id: CONFIG_ID,
        companyName: 'Texzium',
        whatsappNumber: '+910000000000',
        defaultSenderName: 'Texzium',
        phoneNumberId: '1234567890',
        businessAccount: '9876543210',
        isActive: true,
        accessTokenSet: true,
        webhookTokenSet: true,
        createdAt: '2026-06-25T00:00:00.000Z',
        updatedAt: '2026-06-25T00:00:00.000Z',
      });
      expect(res.body[1].webhookTokenSet).toBe(false);
    });

    it('creates a configuration, stores the tokens, returns none and audits none', async () => {
      const res = await send(ROUTES[1], ['whatsapp.config.manage']);

      expect(res.status).toBe(201);
      expect(db.whatsAppConfig.create.mock.calls[0][0].data).toMatchObject({
        accessToken: ACCESS_TOKEN,
        webhookToken: WEBHOOK_TOKEN,
      });
      expect(res.body).toMatchObject({
        accessTokenSet: true,
        webhookTokenSet: true,
      });
      noSecret(res.body);

      const audit = db.auditLog.create.mock.calls[0][0].data;
      expect(audit).toMatchObject({
        userId: ACTOR,
        action: 'WHATSAPP_CONFIG_CREATED',
        module: 'WhatsApp',
        recordId: 'c-new',
      });
      expect(audit.newData).toMatchObject({
        accessTokenSet: true,
        webhookTokenSet: true,
      });
      noSecret(audit);
    });

    it.each([
      ['an unknown field', { ...VALID_CONFIG, extra: 'x' }],
      [
        'a nested relation write',
        {
          ...VALID_CONFIG,
          WhatsAppConversation: { create: { customerNumber: '1' } },
        },
      ],
      [
        'a token that is an object',
        { ...VALID_CONFIG, accessToken: { set: 'x' } },
      ],
      ['a missing access token', { ...VALID_CONFIG, accessToken: undefined }],
    ])('refuses %s (400) and stores nothing', async (_label, body) => {
      const res = await send(ROUTES[1], ['whatsapp.config.manage'], body);
      expect(res.status).toBe(400);
      expect(db.whatsAppConfig.create).not.toHaveBeenCalled();
    });
  });

  describe('updating keeps secrets server-side', () => {
    const patch = (body: object) =>
      send(ROUTES[2], ['whatsapp.config.manage'], body);
    const updateData = () => db.whatsAppConfig.update.mock.calls[0][0].data;
    const auditData = () => db.auditLog.create.mock.calls[0][0].data;

    it('keeps both tokens when they are left out', async () => {
      const res = await patch({ companyName: 'Texzium Ltd' });

      expect(res.status).toBe(200);
      expect(updateData()).toEqual({ companyName: 'Texzium Ltd' });
      expect(auditData().newData).toEqual({
        changedFields: ['companyName'],
        accessTokenChanged: false,
        webhookTokenChanged: false,
      });
      noSecret(res.body);
    });

    it('keeps both tokens when they are sent empty', async () => {
      await patch({ accessToken: '', webhookToken: '', isActive: false });
      expect(updateData()).toEqual({ isActive: false });
    });

    it('keeps a token sent unchanged, and reports no change', async () => {
      await patch({ accessToken: ACCESS_TOKEN });
      expect(updateData()).toEqual({});
      expect(auditData().newData.accessTokenChanged).toBe(false);
    });

    it('replaces a token when a new one is sent, and audits only that it changed', async () => {
      const res = await patch({
        accessToken: 'NEW-SENTINEL-TOKEN-88',
        webhookToken: 'NEW-VERIFY-99',
      });

      expect(updateData()).toEqual({
        accessToken: 'NEW-SENTINEL-TOKEN-88',
        webhookToken: 'NEW-VERIFY-99',
      });
      expect(auditData().newData).toEqual({
        changedFields: [],
        accessTokenChanged: true,
        webhookTokenChanged: true,
      });
      expect(JSON.stringify(auditData())).not.toMatch(
        /NEW-SENTINEL|NEW-VERIFY/,
      );
      expect(JSON.stringify(res.body)).not.toMatch(/NEW-SENTINEL|NEW-VERIFY/);
      expect(res.body).toMatchObject({
        accessTokenSet: true,
        webhookTokenSet: true,
      });
    });

    it('answers 404 for an unknown configuration', async () => {
      const res = await send(
        { ...ROUTES[2], url: '/whatsapp/configs/unknown' },
        ['whatsapp.config.manage'],
        { companyName: 'X' },
      );
      expect(res.status).toBe(404);
      expect(db.whatsAppConfig.update).not.toHaveBeenCalled();
    });

    it('refuses an unknown field (400)', async () => {
      expect((await patch({ id: 'other', companyName: 'X' })).status).toBe(400);
    });
  });

  describe('bot configuration and routes take only their own fields', () => {
    it('creates them from the validated fields only', async () => {
      expect((await send(ROUTES[3], ['whatsapp.config.manage'])).status).toBe(
        201,
      );
      expect(db.whatsAppBotConfig.create.mock.calls[0][0].data).toEqual({
        whatsappConfigId: CONFIG_ID,
        welcomeMessage: 'Hi',
        unknownUserMessage: 'Name?',
        enableCustomerLookup: undefined,
        enableLeadCapture: undefined,
        enableHumanHandoff: undefined,
        isActive: undefined,
      });
      expect((await send(ROUTES[4], ['whatsapp.config.manage'])).status).toBe(
        201,
      );
    });

    it.each([
      [3, { whatsappConfig: { create: VALID_CONFIG } }],
      [3, { id: 'chosen' }],
      [4, { role: { connect: { id: 'r' } } }],
      [4, { optionNumber: 'one' }],
    ])('refuses extra or malformed fields (route %i)', async (i, extra) => {
      const route = ROUTES[i];
      const res = await send(route, ['whatsapp.config.manage'], {
        ...route.body,
        ...extra,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('sending keeps the access token out of responses, errors and logs', () => {
    const sendRoute = ROUTES[5];
    const sendAs = (body = sendRoute.body) =>
      send(sendRoute, ['whatsapp.messages.send'], body);

    it('uses the token towards the Graph API only, and returns a plain summary', async () => {
      const res = await sendAs();

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ status: 'SENT', messageId: 'wamid.TEST-1' });
      expect(graph.state.requests).toHaveLength(1);
      expect(graph.state.requests[0]).toMatchObject({
        url: '/v20.0/1234567890/messages',
        authorization: `Bearer ${ACCESS_TOKEN}`,
        body: {
          messaging_product: 'whatsapp',
          to: '+910000000001',
          type: 'text',
          text: { body: 'Hello' },
        },
      });
    });

    it("turns a refusal into a clean 502 carrying only Meta's message", async () => {
      graph.state.mode = 'reject';
      const res = await sendAs();

      expect(res.status).toBe(502);
      expect(res.body.message).toBe(
        'WhatsApp did not accept the message: Invalid OAuth access token.',
      );
      noSecret(res.body);
    });

    it("scrubs the token if Meta's message ever echoes it", async () => {
      graph.state.mode = 'echo-token';
      const res = await sendAs();

      expect(res.status).toBe(502);
      expect(res.body.message).toContain('[redacted]');
      noSecret(res.body);
    });

    it('reports an unreachable Graph API as a 502', async () => {
      const saved = process.env.WHATSAPP_GRAPH_BASE_URL;
      process.env.WHATSAPP_GRAPH_BASE_URL = 'http://127.0.0.1:1/v20.0';
      try {
        const res = await sendAs();
        expect(res.status).toBe(502);
        expect(res.body.message).toBe('WhatsApp could not be reached.');
        noSecret(res.body);
      } finally {
        process.env.WHATSAPP_GRAPH_BASE_URL = saved;
      }
    });

    it('answers 404 for an unknown or inactive configuration, without calling out', async () => {
      const res = await sendAs({
        configId: 'unknown',
        to: '+910000000001',
        message: 'Hello',
      });
      expect(res.status).toBe(404);
      expect(graph.state.requests).toHaveLength(0);
    });

    it.each([
      [{ configId: CONFIG_ID, to: '+910000000001' }],
      [
        {
          configId: CONFIG_ID,
          to: '+910000000001',
          message: 'Hi',
          accessToken: 'x',
        },
      ],
      [{ configId: CONFIG_ID, to: { nested: true }, message: 'Hi' }],
    ])(
      'refuses a malformed request (400) without calling out',
      async (body) => {
        expect((await sendAs(body)).status).toBe(400);
        expect(graph.state.requests).toHaveLength(0);
      },
    );

    it('never wrote the token into any log line, across every case above', () => {
      const all = logs.lines.join('\n');
      expect(all).toContain('whatsapp.send.failed');
      expect(all).not.toContain(ACCESS_TOKEN);
      expect(all).not.toContain(WEBHOOK_TOKEN);
    });
  });

  describe('the webhook handshake (login-only)', () => {
    const handshake = (verifyToken: string, auth = true) => {
      const req = request(app.getHttpServer()).get(
        `/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=12345`,
      );
      if (auth) req.set('Authorization', `Bearer ${token([])}`);
      return req;
    };

    it('is 401 without a login token', async () => {
      expect((await handshake(WEBHOOK_TOKEN, false)).status).toBe(401);
    });

    it('answers the challenge for the stored verify token', async () => {
      const res = await handshake(WEBHOOK_TOKEN);
      expect(res.status).toBe(200);
      expect(res.text).toBe('12345');
    });

    it('refuses any other token, including the old hard-coded one', async () => {
      expect((await handshake('wrong')).status).toBe(403);
      expect((await handshake('TEXZIUM_WEBHOOK_SECRET')).status).toBe(403);
    });
  });

  describe("webhook deliveries need Meta's signature", () => {
    const RAW = '{"entry":[],"object":"whatsapp_business_account"}';
    const deliver = (signature?: string) => {
      const req = request(app.getHttpServer())
        .post('/whatsapp/webhook')
        .set('Content-Type', 'application/json');
      if (signature) req.set('X-Hub-Signature-256', signature);
      return req.send(RAW);
    };
    const sign = (body: string, key = APP_SECRET) =>
      `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

    it('processes a correctly signed delivery', async () => {
      const res = await deliver(sign(RAW));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ message: 'No incoming message' });
    });

    it('refuses a missing, foreign or mismatched signature before any processing', async () => {
      expect((await deliver()).status).toBe(401);
      expect((await deliver(sign(RAW, 'not-the-app-secret'))).status).toBe(401);
      expect((await deliver(sign('{"entry":[]}'))).status).toBe(401);
      expect(dbCalls(db)).toBe(0);
    });
  });
});
