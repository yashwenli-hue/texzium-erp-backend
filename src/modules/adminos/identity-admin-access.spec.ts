/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../core/auth/auth.module';
import { DatabaseModule } from '../../core/database/database.module';
import { PrismaService } from '../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../core/decorators/permissions.decorator';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { USER_DIRECTORY_SELECT } from '../../core/security/user-select';
import { PermissionsController } from './permissions/permissions.controller';
import { PermissionsModule } from './permissions/permissions.module';
import { RolePermissionsController } from './role-permissions/role-permissions.controller';
import { RolePermissionsModule } from './role-permissions/role-permissions.module';
import { RolesController } from './roles/roles.controller';
import { RolesModule } from './roles/roles.module';
import { UsersController } from './users/users.controller';
import { UsersModule } from './users/users.module';

// Administration of users, roles and permissions, through real HTTP with the real global
// JwtAuthGuard and JWT strategy, the real PermissionsGuard, the real redaction
// interceptor and the real services. Only the database is a double: a refused request
// must never reach it.

const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const ROLE = '00000000-0000-4000-8000-0000000000b1';
const PERM = '00000000-0000-4000-8000-0000000000c1';

interface Route {
  name: string;
  method: 'get' | 'post';
  url: string;
  needs: string;
  body?: object;
}

const ROUTES: Route[] = [
  { name: 'list users', method: 'get', url: '/users', needs: 'users.view' },
  {
    name: 'create user',
    method: 'post',
    url: '/users',
    needs: 'users.create',
    body: {
      fullName: 'New Person',
      email: 'new.person@example.invalid',
      password: 'a-test-password',
      roleId: ROLE,
    },
  },
  { name: 'list roles', method: 'get', url: '/roles', needs: 'roles.view' },
  {
    name: 'create role',
    method: 'post',
    url: '/roles',
    needs: 'roles.create',
    body: { name: 'TEST_ROLE', description: 'A test role' },
  },
  {
    name: 'list permissions',
    method: 'get',
    url: '/permissions',
    needs: 'roles.view',
  },
  {
    name: 'create permission',
    method: 'post',
    url: '/permissions',
    needs: 'permissions.manage',
    body: { code: 'test.code', name: 'Test Code', module: 'AdminOS' },
  },
  {
    name: 'list role assignments',
    method: 'get',
    url: '/role-permissions',
    needs: 'roles.view',
  },
  {
    name: 'assign a permission to a role',
    method: 'post',
    url: '/role-permissions',
    needs: 'roles.permissions.assign',
    body: { roleId: ROLE, permissionId: PERM },
  },
];

const ALL_ADMIN = [
  'users.view',
  'users.create',
  'roles.view',
  'roles.create',
  'permissions.manage',
  'roles.permissions.assign',
];

// The permission the target of an assignment carries in the double, and the codes the
// role used for a new user carries.
const TARGET_CODE = 'leads.view';
const ROLE_CODES = ['leads.view', 'customers.view'];

const USER_ROW = {
  id: '00000000-0000-4000-8000-0000000000d1',
  employeeCode: null,
  fullName: 'New Person',
  email: 'new.person@example.invalid',
  phone: null,
  status: 'ACTIVE',
  roleId: ROLE,
  role: { id: ROLE, name: 'SALES', description: null },
  createdAt: new Date('2026-10-10T00:00:00Z'),
  updatedAt: new Date('2026-10-10T00:00:00Z'),
};

function prismaDouble() {
  const db: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: ACTOR }),
      // A row as an unsafe select WOULD return it: the interceptor must still strip it.
      findMany: jest
        .fn()
        .mockResolvedValue([
          { ...USER_ROW, passwordHash: '$2b$10$not-for-you' },
        ]),
      create: jest.fn().mockResolvedValue(USER_ROW),
    },
    role: {
      findUnique: jest.fn().mockResolvedValue({
        id: ROLE,
        name: 'SALES',
        permissions: ROLE_CODES.map((code) => ({ permission: { code } })),
      }),
      findMany: jest.fn().mockResolvedValue([{ id: ROLE, name: 'SALES' }]),
      create: jest.fn().mockResolvedValue({
        id: ROLE,
        name: 'TEST_ROLE',
        description: 'A test role',
      }),
    },
    permission: {
      findUnique: jest.fn().mockResolvedValue({ id: PERM, code: TARGET_CODE }),
      findMany: jest.fn().mockResolvedValue([{ id: PERM, code: TARGET_CODE }]),
      create: jest.fn().mockResolvedValue({
        id: PERM,
        code: 'test.code',
        name: 'Test Code',
        module: 'AdminOS',
      }),
    },
    rolePermission: {
      create: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-0000000000e1',
        roleId: ROLE,
        permissionId: PERM,
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));

  return db;
}

function calls(db: any): number {
  let n = 0;
  for (const model of Object.values(db)) {
    if (typeof model === 'function') {
      n += (model as jest.Mock).mock.calls.length;
      continue;
    }
    for (const fn of Object.values(model as object)) {
      n += (fn as jest.Mock).mock.calls.length;
    }
  }
  return n;
}

function token(permissions: string[], role = 'TEST') {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: ACTOR, email: 'actor@example.invalid', role, permissions },
    { expiresIn: '1h' },
  );
}

describe('Identity administration: access, delegation, audit and redaction', () => {
  let app: INestApplication;
  let db: any;

  beforeAll(async () => {
    db = prismaDouble();
    const moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        AuthModule,
        UsersModule,
        RolesModule,
        PermissionsModule,
        RolePermissionsModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
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
  });

  beforeEach(() => {
    const fresh = prismaDouble();
    for (const key of Object.keys(fresh)) db[key] = fresh[key];
    db.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(db));
  });

  function send(route: Route, permissions?: string[], role?: string) {
    const req = (request(app.getHttpServer()) as any)[route.method](route.url);
    if (permissions)
      req.set('Authorization', `Bearer ${token(permissions, role)}`);
    return route.body ? req.send(route.body) : req;
  }

  describe('the route-to-permission matrix', () => {
    const controllers = [
      UsersController,
      RolesController,
      PermissionsController,
      RolePermissionsController,
    ];

    it('declares exactly the approved permission on every handler', () => {
      const declared: Record<string, string[]> = {};
      for (const controller of controllers) {
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          if (name === 'constructor') continue;
          declared[`${controller.name}.${name}`] =
            Reflect.getMetadata(PERMISSIONS_KEY, controller.prototype[name]) ??
            [];
        }
      }

      expect(declared).toEqual({
        'UsersController.create': ['users.create'],
        'UsersController.findAll': ['users.view'],
        'RolesController.create': ['roles.create'],
        'RolesController.findAll': ['roles.view'],
        'PermissionsController.create': ['permissions.manage'],
        'PermissionsController.findAll': ['roles.view'],
        'RolePermissionsController.assign': ['roles.permissions.assign'],
        'RolePermissionsController.findAll': ['roles.view'],
      });
    });

    it('puts PermissionsGuard on every one of those controllers', () => {
      for (const controller of controllers) {
        expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(
          PermissionsGuard,
        );
      }
    });
  });

  describe.each(ROUTES)('$name ($method $url)', (route) => {
    it('is 401 without a token, and reaches nothing', async () => {
      const res = await send(route);

      expect(res.status).toBe(401);
      expect(calls(db)).toBe(0);
    });

    it(`is 403 with every other admin permission but ${route.needs}`, async () => {
      const res = await send(
        route,
        ALL_ADMIN.filter((p) => p !== route.needs).concat(ROLE_CODES),
      );

      expect(res.status).toBe(403);
      expect(calls(db)).toBe(0);
    });

    it(`succeeds with ${route.needs}`, async () => {
      // A POST that hands out permissions also needs those permissions (see below).
      const res = await send(route, [route.needs, ...ROLE_CODES]);

      expect(res.status).toBe(route.method === 'post' ? 201 : 200);
    });
  });

  describe('hold what you grant', () => {
    const assign = ROUTES.find(
      (r) => r.url === '/role-permissions' && r.method === 'post',
    )!;
    const createUser = ROUTES.find(
      (r) => r.url === '/users' && r.method === 'post',
    )!;

    it('refuses to assign a permission the caller does not hold', async () => {
      const res = await send(assign, ['roles.permissions.assign']);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain(TARGET_CODE);
      expect(db.rolePermission.create).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('gives SUPER_ADMIN no exemption: it can assign only what it holds', async () => {
      const refused = await send(
        assign,
        ['roles.permissions.assign', 'customers.view'],
        'SUPER_ADMIN',
      );
      expect(refused.status).toBe(403);

      const allowed = await send(
        assign,
        ['roles.permissions.assign', TARGET_CODE],
        'SUPER_ADMIN',
      );
      expect(allowed.status).toBe(201);
    });

    it('assigns a held permission and audits it, attributed to the caller', async () => {
      const res = await send(assign, ['roles.permissions.assign', TARGET_CODE]);

      expect(res.status).toBe(201);
      expect(db.rolePermission.create).toHaveBeenCalledWith({
        data: { roleId: ROLE, permissionId: PERM },
      });
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: ACTOR,
          action: 'ROLE_PERMISSION_ASSIGNED',
          module: 'AdminOS',
          recordId: '00000000-0000-4000-8000-0000000000e1',
          newData: {
            roleId: ROLE,
            roleName: 'SALES',
            permissionId: PERM,
            permissionCode: TARGET_CODE,
          },
        },
      });
    });

    it('answers 404 for an unknown permission or role, granting nothing', async () => {
      db.permission.findUnique.mockResolvedValueOnce(null);
      expect(
        (await send(assign, ['roles.permissions.assign', TARGET_CODE])).status,
      ).toBe(404);

      db.role.findUnique.mockResolvedValueOnce(null);
      expect(
        (await send(assign, ['roles.permissions.assign', TARGET_CODE])).status,
      ).toBe(404);

      expect(db.rolePermission.create).not.toHaveBeenCalled();
    });

    it('refuses to create a user in a role carrying permissions the caller lacks', async () => {
      const res = await send(createUser, ['users.create', 'leads.view']);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('customers.view');
      expect(db.user.create).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    });

    it('refuses an administrative change by a user who no longer exists', async () => {
      db.user.findUnique.mockResolvedValueOnce(null);
      const res = await send(assign, ['roles.permissions.assign', TARGET_CODE]);

      expect(res.status).toBe(401);
      expect(db.rolePermission.create).not.toHaveBeenCalled();
    });
  });

  describe('auditing', () => {
    it('records role creation', async () => {
      const route = ROUTES.find(
        (r) => r.url === '/roles' && r.method === 'post',
      )!;
      expect((await send(route, ['roles.create'])).status).toBe(201);
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: ACTOR,
          action: 'ROLE_CREATED',
          newData: { name: 'TEST_ROLE', description: 'A test role' },
        }),
      });
    });

    it('records permission creation', async () => {
      const route = ROUTES.find(
        (r) => r.url === '/permissions' && r.method === 'post',
      )!;
      expect((await send(route, ['permissions.manage'])).status).toBe(201);
      expect(db.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: ACTOR,
          action: 'PERMISSION_CREATED',
          newData: { code: 'test.code', name: 'Test Code', module: 'AdminOS' },
        }),
      });
    });
  });

  describe('no credential leaves the server', () => {
    it('GET /users selects only safe fields, and strips a hash even if one slips through', async () => {
      const res = await request(app.getHttpServer())
        .get('/users')
        .set('Authorization', `Bearer ${token(['users.view'])}`);

      expect(res.status).toBe(200);
      expect(db.user.findMany).toHaveBeenCalledWith({
        select: USER_DIRECTORY_SELECT,
      });
      expect(USER_DIRECTORY_SELECT).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      expect(res.body[0]).toMatchObject({
        id: USER_ROW.id,
        fullName: 'New Person',
      });
    });

    it('POST /users stores a bcrypt hash, returns no credential and audits none', async () => {
      const route = ROUTES.find(
        (r) => r.url === '/users' && r.method === 'post',
      )!;
      const res = await send(route, ['users.create', ...ROLE_CODES]);

      expect(res.status).toBe(201);
      const args = db.user.create.mock.calls[0][0];
      expect(args.select).toBe(USER_DIRECTORY_SELECT);
      expect(args.data.passwordHash).toMatch(/^\$2[aby]\$10\$/);
      expect(args.data.passwordHash).not.toContain('a-test-password');

      expect(JSON.stringify(res.body)).not.toMatch(
        /passwordHash|a-test-password/,
      );
      const audit = JSON.stringify(db.auditLog.create.mock.calls[0][0]);
      expect(audit).not.toMatch(/password/i);
      expect(db.auditLog.create.mock.calls[0][0].data).toMatchObject({
        userId: ACTOR,
        action: 'USER_CREATED',
        recordId: USER_ROW.id,
      });
    });
  });
});
