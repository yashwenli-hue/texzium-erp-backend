/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- the fake database is intentionally loosely typed */
import { GoneException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';

import { PrismaService } from '../../core/database/prisma.service';
import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { WorkflowExecutorService } from '../adminos/workflow-executor/workflow-executor.service';
import { QuotationsController } from './quotations/quotations.controller';
import { QuotationsService } from './quotations/quotations.service';

// A Sales Order is created from an approved Proforma Invoice
// (SalesOrdersService.create) and in no other way. These specs keep it that way.

const SRC = path.resolve(__dirname, '../..');
const THE_ONE_CREATOR =
  'modules/revenueos/sales-orders/sales-orders.service.ts';

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [full] : [];
  });

// Every way the code could write a SalesOrder row: a direct create, a bulk
// create, an upsert, a nested create from a parent, a raw insert, or a model
// reached through a computed name.
const WRITES_A_SALES_ORDER = [
  /\.salesOrder\s*\.\s*(create|createMany|createManyAndReturn|upsert)\b/,
  /\bsalesOrders?\s*:\s*\{\s*(create|createMany|connectOrCreate)\b/,
  /INSERT\s+INTO\s+"?SalesOrder"?(\s|\()/i,
  /\[\s*['"`]salesOrder['"`]\s*\]/,
  /(prisma|tx|this\.prisma)\s*\[[^\]]+\]\s*\.\s*(create|createMany|upsert)\b/,
];

describe('Sales Order creation paths', () => {
  it('the only code that writes a SalesOrder row is SalesOrdersService.create', () => {
    const creators: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(SRC, file).split(path.sep).join('/');
      const text = fs.readFileSync(file, 'utf8');
      if (WRITES_A_SALES_ORDER.some((re) => re.test(text))) creators.push(rel);
    }
    expect(creators.filter((f) => f !== THE_ONE_CREATOR)).toEqual([]);
    expect(creators.filter((f) => f === THE_ONE_CREATOR)).toEqual([
      THE_ONE_CREATOR,
    ]);
  });

  it('catches each way of writing one (the scan is not blind)', () => {
    const samples = [
      'await this.prisma.salesOrder.create({})',
      'await tx.salesOrder\n .createMany({})',
      'prisma.salesOrder.upsert({})',
      'quotation.update({ data: { salesOrders: { create: {} } } })',
      'proforma.update({ data: { salesOrders: {\n createMany: {} } } })',
      'await prisma.$executeRaw`INSERT INTO "SalesOrder" ("id") VALUES (1)`',
      "const m = prisma['salesOrder']",
      'await tx[model].create({})',
    ];
    for (const sample of samples) {
      expect([
        sample,
        WRITES_A_SALES_ORDER.some((re) => re.test(sample)),
      ]).toEqual([sample, true]);
    }
    for (const innocent of [
      'await tx.salesOrder.updateMany({})',
      'await tx.salesOrderEvent.create({})',
      'await this.prisma.salesOrder.findMany({})',
      'INSERT INTO "SalesOrderEvent" ("id")',
    ]) {
      expect([
        innocent,
        WRITES_A_SALES_ORDER.some((re) => re.test(innocent)),
      ]).toEqual([innocent, false]);
    }
  });
});

const FRAMEWORK_PROBES = [
  'then',
  'onModuleInit',
  'onApplicationBootstrap',
  'onModuleDestroy',
  'beforeApplicationShutdown',
  'onApplicationShutdown',
];

describe('the retired Quotation convert route', () => {
  // A database that fails the test on any use at all.
  const forbiddenDb = new Proxy(
    {},
    {
      get: (_t, prop) => {
        // Nest probes a provider for `then`, symbols and lifecycle hooks; that
        // is not a use of the database.
        if (typeof prop === 'symbol' || FRAMEWORK_PROBES.includes(prop)) {
          return undefined;
        }
        throw new Error(
          `the convert route touched the database (${String(prop)})`,
        );
      },
    },
  );

  const build = async () => {
    const mod = await Test.createTestingModule({
      controllers: [QuotationsController],
      providers: [
        QuotationsService,
        { provide: PrismaService, useValue: forbiddenDb },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (c: any) => {
          c.switchToHttp().getRequest().user = { id: 'u', permissions: [] };
          return true;
        },
      })
      .compile();
    const app = mod.createNestApplication();
    await app.init();
    return app;
  };

  it('answers 410 with a clear message, whatever quotation it is sent, and reads and writes nothing', async () => {
    const app = await build();
    for (const id of [
      '00000000-0000-4000-8000-000000000001',
      'not-even-an-id',
    ]) {
      const res = await request(app.getHttpServer())
        .post(`/quotations/${id}/convert`)
        .send({})
        .expect(410);
      expect(res.body.message).toMatch(/no longer supported/);
      expect(res.body.message).toMatch(/Proforma Invoice/);
    }
    await app.close();
  });

  it('the service no longer has a conversion method', () => {
    expect(
      (QuotationsService.prototype as any).convertToSalesOrder,
    ).toBeUndefined();
    expect(() => {
      throw new GoneException('x');
    }).toThrow();
  });
});

describe('the retired workflow-executor QUOTATION_APPROVED trigger', () => {
  it('creates no Sales Order, reads nothing and writes nothing', async () => {
    const touched: string[] = [];
    const db = new Proxy(
      {},
      {
        get: (_t, prop) => {
          touched.push(String(prop));
          throw new Error(`the trigger touched the database (${String(prop)})`);
        },
      },
    );
    const service = new WorkflowExecutorService(db as unknown as PrismaService);

    const result = await service.execute({
      trigger: 'QUOTATION_APPROVED',
      referenceId: '00000000-0000-4000-8000-000000000001',
    });

    expect(touched).toEqual([]);
    expect(result).toMatchObject({ success: false, action: 'NONE' });
    expect(JSON.stringify(result)).toMatch(/Proforma Invoice/);
    expect(result).not.toHaveProperty('salesOrder');
  });

  it('still reports an unknown trigger the way it did', async () => {
    const service = new WorkflowExecutorService({} as PrismaService);
    expect(
      await service.execute({ trigger: 'SOMETHING_ELSE', referenceId: 'x' }),
    ).toEqual({
      success: false,
      message: 'No workflow matched',
    });
  });
});
