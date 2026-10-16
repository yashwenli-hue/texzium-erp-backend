/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';

import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { CustomerDeletionController } from '../customer-master/customer-deletion.controller';
import { LeadDeletionController } from '../leads/lead-deletion.controller';
import { DataDeletionsController } from './data-deletion.controller';
import { DataDeletionService } from './data-deletion.service';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

// Who may do what, checked through real HTTP with the REAL PermissionsGuard (only the
// token check is replaced, by a stand-in that puts the test's user on the request): every
// governed route against every one of the five M3 permissions, alone and together. The
// service is a double, so a refused request must never reach it. Nothing here relies on a
// permission implying another one: each is checked on its own, so a dedicated governance
// role can be given any subset later.

const ID = '00000000-0000-4000-8000-0000000000a1';

const LEADS_DELETE = 'leads.delete';
const CUSTOMERS_DELETE = 'customers.delete';
const VIEW = 'governance.deletions.view';
const RESTORE = 'governance.deletions.restore';
const PURGE = 'governance.deletions.purge';
const FIVE = [LEADS_DELETE, CUSTOMERS_DELETE, VIEW, RESTORE, PURGE];

const DELETE_BODY = {
  reasonCode: 'TEST_DATA',
  reason: 'Created while testing',
  version: 'abc123',
};

interface Route {
  name: string;
  method: 'get' | 'post' | 'delete';
  url: string;
  body?: object;
  needs: string[];
  reaches: string; // the service method an allowed call ends in
}

const ROUTES: Route[] = [
  {
    name: 'lead deletion preview',
    method: 'get',
    url: `/leads/${ID}/deletion-preview`,
    needs: [LEADS_DELETE],
    reaches: 'preview',
  },
  {
    name: 'lead deletion',
    method: 'delete',
    url: `/leads/${ID}`,
    body: DELETE_BODY,
    needs: [LEADS_DELETE],
    reaches: 'delete',
  },
  {
    name: 'customer deletion preview',
    method: 'get',
    url: `/customers/${ID}/deletion-preview`,
    needs: [CUSTOMERS_DELETE],
    reaches: 'preview',
  },
  {
    name: 'customer deletion',
    method: 'delete',
    url: `/customers/${ID}`,
    body: DELETE_BODY,
    needs: [CUSTOMERS_DELETE],
    reaches: 'delete',
  },
  {
    name: 'deletion log list',
    method: 'get',
    url: '/data-deletions',
    needs: [VIEW],
    reaches: 'list',
  },
  {
    name: 'one deletion log entry (with its snapshot)',
    method: 'get',
    url: `/data-deletions/${ID}`,
    needs: [VIEW],
    reaches: 'findOne',
  },
  {
    name: 'restore preview',
    method: 'get',
    url: `/data-deletions/${ID}/restore-preview`,
    needs: [VIEW, RESTORE],
    reaches: 'restorePreview',
  },
  {
    name: 'restore',
    method: 'post',
    url: `/data-deletions/${ID}/restore`,
    body: { version: 'v1' },
    needs: [VIEW, RESTORE],
    reaches: 'restore',
  },
  {
    name: 'purge',
    method: 'post',
    url: `/data-deletions/${ID}/purge`,
    body: {},
    needs: [VIEW, PURGE],
    reaches: 'purge',
  },
];

// Every set of permissions worth trying: none, each one alone, each one missing from the
// full set, the full set, and the ordinary lead/customer permissions people have today.
const SETS: Array<[string, string[]]> = [
  ['no permissions', []],
  [
    'ordinary lead and customer permissions only',
    [
      'leads.view',
      'leads.create',
      'leads.edit',
      'leads.deactivate',
      'leads.assign',
      'leads.qualify',
      'leads.reject',
      'customers.view',
      'customers.create',
      'customers.edit',
      'customers.deactivate',
      'opportunities.view',
      'quotations.view',
      'collections.view',
    ],
  ],
  ...FIVE.map((p): [string, string[]] => [`only ${p}`, [p]]),
  ...FIVE.map((p): [string, string[]] => [
    `all five except ${p}`,
    FIVE.filter((x) => x !== p),
  ]),
  ['all five (SUPER_ADMIN)', FIVE],
];

describe('who may delete, view, restore and purge (real HTTP, real PermissionsGuard)', () => {
  let app: INestApplication;
  let user: { id: string; permissions: string[] } | undefined;

  const service = {
    preview: jest.fn(async () => ({ eligible: true })),
    delete: jest.fn(async () => ({ id: 'ts-1' })),
    list: jest.fn(async () => []),
    findOne: jest.fn(async () => ({ id: 'ts-1' })),
    restorePreview: jest.fn(async () => ({ eligible: true })),
    restore: jest.fn(async () => ({ id: 'ts-1' })),
    purge: jest.fn(async () => ({ id: 'ts-1' })),
  };
  const reached = () =>
    Object.entries(service)
      .filter(([, fn]) => fn.mock.calls.length > 0)
      .map(([name]) => name);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        LeadDeletionController,
        CustomerDeletionController,
        DataDeletionsController,
      ],
      providers: [{ provide: DataDeletionService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          if (!user) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .overrideGuard(RecordScopeGuard)
      .useValue(SCOPE_TESTED_ELSEWHERE)
      .compile();

    app = moduleRef.createNestApplication();
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
    await app.close();
  });

  beforeEach(() => {
    user = undefined;
    jest.clearAllMocks();
  });

  const call = (route: Route) => {
    const req = request(app.getHttpServer())[route.method](route.url);
    return route.body ? req.send(route.body) : req;
  };

  describe('every route against every set of permissions', () => {
    for (const route of ROUTES) {
      describe(route.name, () => {
        it.each(SETS)('with %s', async (_label, permissions) => {
          user = { id: 'user-1', permissions };
          const allowed = route.needs.every((p) => permissions.includes(p));
          const res = await call(route);

          if (allowed) {
            expect(res.status).toBeLessThan(300);
            expect(reached()).toEqual([route.reaches]);
          } else {
            expect(res.status).toBe(403);
            expect(reached()).toEqual([]);
          }
        });

        it('is refused (401) without a signed-in user, before anything else', async () => {
          const res = await call(route);
          expect(res.status).toBe(401);
          expect(reached()).toEqual([]);
        });
      });
    }
  });

  describe('the boundaries, one by one', () => {
    const only = (...permissions: string[]) => {
      user = { id: 'user-1', permissions };
    };

    it('without governance.deletions.view: no log, no entry or snapshot, no restore preview, no restore, no purge', async () => {
      only(LEADS_DELETE, CUSTOMERS_DELETE, RESTORE, PURGE);
      const statuses: number[] = [];
      for (const route of ROUTES.filter((r) => r.needs.includes(VIEW))) {
        statuses.push((await call(route)).status);
      }
      expect(statuses.every((s) => s === 403)).toBe(true);
      expect(reached()).toEqual([]);
    });

    it('without leads.delete / customers.delete: nobody deletes (or previews deleting) that kind, even with everything else', async () => {
      only(...FIVE.filter((p) => p !== LEADS_DELETE));
      expect((await call(ROUTES[0])).status).toBe(403);
      expect((await call(ROUTES[1])).status).toBe(403);
      only(...FIVE.filter((p) => p !== CUSTOMERS_DELETE));
      expect((await call(ROUTES[2])).status).toBe(403);
      expect((await call(ROUTES[3])).status).toBe(403);
      expect(reached()).toEqual([]);
    });

    it('leads.delete does not delete customers, and customers.delete does not delete leads', async () => {
      only(LEADS_DELETE);
      expect((await call(ROUTES[3])).status).toBe(403);
      only(CUSTOMERS_DELETE);
      expect((await call(ROUTES[1])).status).toBe(403);
      expect(reached()).toEqual([]);
    });

    it('without governance.deletions.restore: no restore (preview or restore), however much else is held', async () => {
      only(...FIVE.filter((p) => p !== RESTORE));
      expect(
        (await call(ROUTES.find((r) => r.reaches === 'restorePreview')!))
          .status,
      ).toBe(403);
      expect(
        (await call(ROUTES.find((r) => r.reaches === 'restore')!)).status,
      ).toBe(403);
      expect(reached()).toEqual([]);
    });

    it('without governance.deletions.purge: no purge, however much else is held', async () => {
      only(...FIVE.filter((p) => p !== PURGE));
      expect(
        (await call(ROUTES.find((r) => r.reaches === 'purge')!)).status,
      ).toBe(403);
      expect(reached()).toEqual([]);
    });

    it('a restorer who may not purge (and the reverse) are each held to their own permission', async () => {
      only(VIEW, RESTORE);
      expect(
        (await call(ROUTES.find((r) => r.reaches === 'restore')!)).status,
      ).toBeLessThan(300);
      expect(
        (await call(ROUTES.find((r) => r.reaches === 'purge')!)).status,
      ).toBe(403);
      jest.clearAllMocks();
      only(VIEW, PURGE);
      expect(
        (await call(ROUTES.find((r) => r.reaches === 'purge')!)).status,
      ).toBeLessThan(300);
      expect(
        (await call(ROUTES.find((r) => r.reaches === 'restore')!)).status,
      ).toBe(403);
    });

    it('a permission name that merely looks similar grants nothing', async () => {
      only(
        'governance.deletions',
        'governance.deletions.view.all',
        'leads.delete.own',
        'customers.deletes',
        'admin',
        '*',
      );
      for (const route of ROUTES) {
        expect((await call(route)).status).toBe(403);
      }
      expect(reached()).toEqual([]);
    });
  });
});

describe('the governed routes, read from the code', () => {
  const controllers = [
    LeadDeletionController,
    CustomerDeletionController,
    DataDeletionsController,
  ];

  const found = controllers.flatMap((controller) =>
    Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = controller.prototype[name] as () => unknown;
        return {
          controller: controller.name,
          name,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as
            | RequestMethod
            | undefined,
          path: Reflect.getMetadata(PATH_METADATA, handler) as string,
          permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler) as
            | string[]
            | undefined,
        };
      })
      .filter((r) => r.method !== undefined),
  );

  it('has exactly the nine routes this spec exercises (a new route must be added here, with its permission)', () => {
    expect(found).toHaveLength(ROUTES.length);
  });

  it('puts the JWT guard and the permissions guard on every one of the three controllers', () => {
    for (const controller of controllers) {
      const guards = Reflect.getMetadata('__guards__', controller) as unknown[];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(PermissionsGuard);
    }
  });

  it('declares permissions on every route, only ever from the five, and the five are all used', () => {
    for (const route of found) {
      expect(route.permissions?.length).toBeGreaterThan(0);
      for (const p of route.permissions ?? []) expect(FIVE).toContain(p);
    }
    const used = new Set(found.flatMap((r) => r.permissions ?? []));
    expect([...used].sort()).toEqual([...FIVE].sort());
  });

  it('matches the table: each route needs exactly the permissions the table says', () => {
    const declared = found
      .map((r) => [...(r.permissions ?? [])].sort().join('+'))
      .sort();
    const expected = ROUTES.map((r) => [...r.needs].sort().join('+')).sort();
    expect(declared).toEqual(expected);
  });

  it('restoring and purging both require seeing the record: each also needs governance.deletions.view', () => {
    const lifecycle = found.filter((r) =>
      ['restorePreview', 'restore', 'purge'].includes(r.name),
    );
    expect(lifecycle).toHaveLength(3);
    for (const route of lifecycle) {
      expect(route.permissions).toContain(VIEW);
      expect(route.permissions).toHaveLength(2);
    }
  });

  it('has no create, update or delete route for a tombstone itself', () => {
    const tombstoneRoutes = found.filter(
      (r) => r.controller === 'DataDeletionsController',
    );
    expect(tombstoneRoutes.map((r) => r.name).sort()).toEqual(
      ['findOne', 'list', 'purge', 'restore', 'restorePreview'].sort(),
    );
    for (const route of tombstoneRoutes) {
      expect([RequestMethod.GET, RequestMethod.POST]).toContain(route.method);
    }
  });
});

describe('what M3 leaves alone, and what never happens by itself', () => {
  const src = path.resolve(__dirname, '..', '..', '..');
  const sources: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
        sources.push(full);
    }
  };
  walk(src);
  const text = (file: string) => fs.readFileSync(file, 'utf8');
  const rel = (file: string) =>
    path.relative(src, file).split(path.sep).join('/');

  it('automatic purging exists in exactly one place: the worker, which calls purgeExpired; by-hand purge() is called from the controller route only; no scheduler library or decorator is used', () => {
    const calls = (pattern: RegExp) =>
      sources.filter((file) => pattern.test(text(file))).map(rel);

    expect(calls(/@nestjs\/schedule|@Cron\(|@Interval\(|@Timeout\(/)).toEqual(
      [],
    );
    expect(calls(/\.purgeExpired\(/)).toEqual([
      'modules/revenueos/data-governance/data-deletion-purge.worker.ts',
    ]);
    expect(calls(/\.purge\(/)).toEqual([
      'modules/revenueos/data-governance/data-deletion.controller.ts',
    ]);
    // the module registers it as a provider (and nothing else constructs one)
    expect(calls(/providers: \[[^\]]*DataDeletionPurgeWorker/)).toEqual([
      'modules/revenueos/data-governance/data-governance.module.ts',
    ]);
    expect(calls(/new DataDeletionPurgeWorker\(/)).toEqual([]);
  });

  it('uses the STORED deadline and nothing else: the automatic purge compares with purgeAfter, strictly after (the deadline itself is still inside the window), and nothing a client sends can set it', () => {
    const service = text(path.join(__dirname, 'data-deletion.service.ts'));
    const auto = service.slice(
      service.indexOf('async purgeExpired('),
      service.indexOf('private conflict('),
    );
    expect(auto).toMatch(/now\.getTime\(\) <= record\.purgeAfter\.getTime\(\)/);
    expect(auto).not.toMatch(/RECOVERY_WINDOW_DAYS|recoveryDeadline/);
    const listing = service.slice(
      service.indexOf('async findExpiredTombstones('),
      service.indexOf('async purgeExpired('),
    );
    expect(listing).toMatch(/purgeAfter: \{ lt: now \}/);
    expect(listing).not.toMatch(/RECOVERY_WINDOW_DAYS|recoveryDeadline/);
    const dto = text(path.join(__dirname, 'dto', 'delete-record.dto.ts'));
    expect(dto).not.toMatch(/purgeAfter|recoveryDays|window/i);
  });

  it('a by-hand purge has no time restriction left: it does not look at purgeAfter at all', () => {
    const service = text(path.join(__dirname, 'data-deletion.service.ts'));
    const manual = service.slice(
      service.indexOf('async purge('),
      service.indexOf("// The purge worker's side"),
    );
    expect(manual).not.toMatch(/purgeAfter/);
    expect(manual).not.toMatch(/PURGE_TOO_EARLY/);
    expect(manual).toMatch(/PURGE_METHOD\.MANUAL/);
    expect(manual).toMatch(/actorId: actorId as string/);
    expect(manual).toMatch(/this\.erase\(/);
  });

  it('both purge paths go through the ONE erase step, which nulls every personal and recovery-only column in a single update and returns nothing that names the record', () => {
    const service = text(path.join(__dirname, 'data-deletion.service.ts'));
    const calls = service.match(/this\.erase\(/g) ?? [];
    expect(calls).toHaveLength(2); // manual and automatic
    const erase = service.slice(
      service.indexOf('private async erase('),
      service.indexOf('private conflict('),
    );
    for (const column of [
      'entityId',
      'entityCode',
      'entityLabel',
      'reason',
      'survivorId',
      'survivorLabel',
      'deletedById',
    ]) {
      expect(erase).toMatch(new RegExp(`${column}: null`));
    }
    expect(erase).toMatch(/snapshot: PURGED_SNAPSHOT/);
    expect(erase).toMatch(/impact: PURGED_IMPACT/);
    expect(erase).toMatch(/redactSurvivorEvents/);
    // the only update of a tombstone to PURGED is this one
    expect(
      (service.match(/status: DELETION_STATUS\.PURGED/g) ?? []).length,
    ).toBe(1);
    // and no purge answer carries a label
    const manual = service.slice(
      service.indexOf('async purge('),
      service.indexOf("// The purge worker's side"),
    );
    expect(manual).not.toMatch(/label:/);
  });

  it('does not touch how ordinary leads and customers are read: no other module looks at the deletion log', () => {
    const allowed = (file: string) =>
      rel(file).startsWith('modules/revenueos/data-governance/') ||
      /(lead|customer)-deletion\.(policy|controller)\.ts$/.test(file);
    const offenders = sources
      .filter((file) => !allowed(file))
      .filter((file) => /dataDeletionRecord/.test(text(file)))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('leaves the existing lead and customer routes on their own permissions: the deletion controllers add routes, they change none', () => {
    for (const file of sources.filter((f) =>
      /(leads|customers)\.controller\.ts$|customer-master\.controller\.ts$/.test(
        f,
      ),
    )) {
      expect(text(file)).not.toMatch(
        /governance\.deletions|leads\.delete|customers\.delete/,
      );
    }
  });
  it('keeps the free-text reason out of ordinary history: the survivor and restore events are written without it, and the policies are not even handed it', () => {
    const strip = (code: string) =>
      code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const file of [
      path.join(src, 'modules/revenueos/leads/lead-deletion.policy.ts'),
      path.join(
        src,
        'modules/revenueos/customer-master/customer-deletion.policy.ts',
      ),
    ]) {
      const code = strip(text(file));
      expect(code).not.toMatch(/\.reason\b/);
      expect(code).not.toMatch(/\.reasonCode\b/);
      expect(code).not.toMatch(/Reason:/);
      expect(code).not.toMatch(/deleted as:/);
    }
    const contract = strip(text(path.join(__dirname, 'data-deletion.ts')));
    const survivorEvent = contract.slice(
      contract.indexOf('recordSurvivorEvent('),
      contract.indexOf('}', contract.indexOf('recordSurvivorEvent(')),
    );
    expect(survivorEvent).not.toMatch(/reason/i);
    const restoreContext = contract.slice(
      contract.indexOf('restore(\n'),
      contract.indexOf('Promise<void>', contract.indexOf('restore(\n')),
    );
    expect(restoreContext).not.toMatch(/reason/i);
  });
});
