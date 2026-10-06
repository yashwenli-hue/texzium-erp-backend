/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { AccountsCommercialApprovalController } from '../accounts-commercial-approval/accounts-commercial-approval.controller';
import { AccountsCommercialApprovalService } from '../accounts-commercial-approval/accounts-commercial-approval.service';
import { SalesOrderAdvanceReceiptController } from '../sales-order-advance-receipt/sales-order-advance-receipt.controller';
import { SalesOrderAdvanceReceiptService } from '../sales-order-advance-receipt/sales-order-advance-receipt.service';
import { SalesOrderPaymentTermsController } from '../sales-order-payment-terms/sales-order-payment-terms.controller';
import { SalesOrderPaymentTermsService } from '../sales-order-payment-terms/sales-order-payment-terms.service';
import {
  SALES_ORDER_STATUS,
  SALES_ORDER_TRANSITIONS,
  assertSalesOrderTransition,
  isSalesOrderTransitionAllowed,
} from './sales-order-lifecycle';
import { SalesOrdersController } from './sales-orders.controller';
import { SalesOrdersService } from './sales-orders.service';

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ORDER = uid(1);
const RECEIPT = uid(11);
const RECEIPT_B = uid(12);
const PROFORMA = uid(21);
const PROFORMA_DUP = uid(22);
const PROFORMA_PENDING = uid(23);
const ITEM = uid(31);
const SELLER = uid(41);
const BUYER = uid(42);
const USER_1 = 'user-1';
const USER_2 = 'user-2';

const ALL = [
  'salesorders.view',
  'salesorders.create',
  'salesorders.paymentterms.view',
  'salesorders.paymentterms.create',
  'salesorders.advancereceipts.view',
  'salesorders.advancereceipts.create',
  'salesorders.advancereceipts.verify',
  'salesorders.commercialapproval.view',
  'salesorders.commercialapproval.approve',
];

const root = path.resolve(__dirname, '../../../..');

// ---------------------------------------------------------------------------
// A stateful fake of the database the lifecycle code uses. It keeps real
// compare-and-set semantics for updateMany, real transaction rollback (an undo
// journal per transaction, so interleaved transactions do not disturb each
// other) and a per-key row lock for SELECT ... FOR UPDATE. Flags switch the
// protections off for the negative controls.
// ---------------------------------------------------------------------------
class FakeDb {
  orders = new Map<string, any>();
  receipts = new Map<string, any>();
  approvals: any[] = [];
  terms: any[] = [];
  events: any[] = [];
  prs: any[] = [];
  proformas = new Map<string, any>();
  items = new Map<string, any>();
  seller = new Map<string, any>();
  buyer = new Map<string, any>();
  users = new Map<string, any>();
  seq = 100;
  stripCas = false; // negative control: ignore the status condition
  noProformaLock = false; // negative control: no row lock on the Proforma
  failRequisition = false;
  private locks = new Map<string, Promise<void>>();

  nextId() {
    this.seq += 1;
    return uid(this.seq);
  }

  private match(row: any, where: any) {
    return Object.entries(where).every(([k, v]) => {
      if (this.stripCas && (k === 'status' || k === 'verificationStatus'))
        return true;
      return row[k] === v;
    });
  }

  private project(row: any, select?: any) {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
  }

  client(journal: Array<() => void> | null, held?: string[]): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const undo = (fn: () => void) => journal?.push(fn);

    const updateMany = (store: Map<string, any>) =>
      jest.fn(async (args: any) => {
        let count = 0;
        for (const row of store.values()) {
          if (self.match(row, args.where)) {
            const before = { ...row };
            Object.assign(row, args.data);
            undo(() => Object.assign(row, before));
            count += 1;
          }
        }
        return { count };
      });

    const delegates: any = {
      salesOrder: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.orders.get(a.where.id), a.select),
        ),
        updateMany: updateMany(self.orders),
        count: jest.fn(
          async (a: any) =>
            [...self.orders.values()].filter((o) => self.match(o, a.where))
              .length,
        ),
        create: jest.fn(async (a: any) => {
          const row = {
            id: self.nextId(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...a.data,
          };
          self.orders.set(row.id, row);
          undo(() => self.orders.delete(row.id));
          return { ...row };
        }),
        findMany: jest.fn(async () => [...self.orders.values()]),
      },
      salesOrderAdvanceReceipt: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.receipts.get(a.where.id), a.select),
        ),
        updateMany: updateMany(self.receipts),
        create: jest.fn(async (a: any) => {
          const row = {
            id: self.nextId(),
            verificationStatus: 'PENDING',
            verifiedBy: null,
            verifiedAt: null,
            createdAt: new Date(),
            ...a.data,
          };
          self.receipts.set(row.id, row);
          undo(() => self.receipts.delete(row.id));
          return { ...row };
        }),
        findMany: jest.fn(async () => [...self.receipts.values()]),
      },
      accountsCommercialApproval: {
        create: jest.fn(async (a: any) => {
          const row = {
            id: self.nextId(),
            status: 'APPROVED',
            createdAt: new Date(),
            ...a.data,
          };
          self.approvals.push(row);
          undo(() => self.approvals.splice(self.approvals.indexOf(row), 1));
          return { ...row };
        }),
        findMany: jest.fn(async () => [...self.approvals]),
      },
      salesOrderPaymentTerm: {
        create: jest.fn(async (a: any) => {
          const row = { id: self.nextId(), ...a.data };
          self.terms.push(row);
          undo(() => self.terms.splice(self.terms.indexOf(row), 1));
          return { ...row };
        }),
        findMany: jest.fn(async () => [...self.terms]),
      },
      salesOrderEvent: {
        create: jest.fn(async (a: any) => {
          const row = {
            id: self.nextId(),
            createdAt: new Date(),
            source: undefined,
            ...a.data,
          };
          self.events.push(row);
          undo(() => self.events.splice(self.events.indexOf(row), 1));
          return { ...row };
        }),
        findMany: jest.fn(async (a: any) => {
          const rows = self.events
            .filter((e) => e.salesOrderId === a.where.salesOrderId)
            .sort(
              (x, y) =>
                +y.occurredAt - +x.occurredAt ||
                +y.createdAt - +x.createdAt ||
                y.id.localeCompare(x.id),
            );
          return rows.map((e) => {
            const u = self.users.get(e.actorId);
            return {
              ...e,
              actor: u ? { id: u.id, fullName: u.fullName } : null,
            };
          });
        }),
      },
      proformaInvoice: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.proformas.get(a.where.id)),
        ),
      },
      inventoryItem: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.items.get(a.where.id)),
        ),
      },
      companyGSTRegistration: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.seller.get(a.where.id)),
        ),
      },
      customerGSTRegistration: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.buyer.get(a.where.id)),
        ),
      },
      purchaseRequisition: {
        create: jest.fn(async (a: any) => {
          if (self.failRequisition) throw new Error('requisition failed');
          const row = { id: self.nextId(), ...a.data };
          self.prs.push(row);
          undo(() => self.prs.splice(self.prs.indexOf(row), 1));
          return { ...row };
        }),
      },
      user: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.users.get(a.where.id), a.select),
        ),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, id: string) => {
        const sql = strings.join('?').replace(/\s+/g, ' ');
        if (sql.includes('"ProformaInvoice"') && sql.includes('FOR UPDATE')) {
          if (!self.noProformaLock && held) {
            const key = `proforma:${id}`;
            while (self.locks.has(key)) await self.locks.get(key);
            let release!: () => void;
            self.locks.set(
              key,
              new Promise<void>((r) => {
                release = r;
              }),
            );
            held.push(key);
            (self as any).releasers = (self as any).releasers ?? new Map();
            (self as any).releasers.set(key, release);
          }
          return self.proformas.has(id) ? [{ id }] : [];
        }
        if (sql.includes('FROM "SalesOrder"') && sql.includes('FOR SHARE')) {
          const o = self.orders.get(id);
          return o ? [{ status: o.status }] : [];
        }
        throw new Error(`unexpected raw query: ${sql}`);
      }),
    };

    // Every call yields to the event loop first, like a database round trip,
    // so transactions that overlap really do interleave. The compare-and-set
    // inside updateMany stays atomic (nothing is awaited between matching a row
    // and changing it), as it is in the database.
    const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
    for (const key of Object.keys(delegates)) {
      const target = delegates[key];
      if (typeof target === 'function') {
        delegates[key] = async (...args: any[]) => {
          await tick();
          return target(...args);
        };
        continue;
      }
      for (const method of Object.keys(target)) {
        const original = target[method];
        target[method] = async (...args: any[]) => {
          await tick();
          return original(...args);
        };
      }
    }
    return delegates;
  }

  root(): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const base = self.client(null);
    return {
      ...base,
      $transaction: jest.fn(async (fn: any) => {
        const journal: Array<() => void> = [];
        const held: string[] = [];
        const tx = self.client(journal, held);
        const releaseAll = () => {
          for (const key of held) {
            const release = (self as any).releasers?.get(key);
            self.locks.delete(key);
            release?.();
          }
        };
        try {
          const result = await fn(tx);
          releaseAll();
          return result;
        } catch (err) {
          for (const u of journal.reverse()) u();
          releaseAll();
          throw err;
        }
      }),
    };
  }
}

describe('Sales Order pre-dispatch lifecycle', () => {
  let app: INestApplication;
  let user: { id?: string; permissions?: string[] } | null;
  let fake: FakeDb;

  beforeAll(async () => {
    fake = new FakeDb();
    const moduleRef = await Test.createTestingModule({
      controllers: [
        SalesOrdersController,
        SalesOrderPaymentTermsController,
        SalesOrderAdvanceReceiptController,
        AccountsCommercialApprovalController,
      ],
      providers: [
        SalesOrdersService,
        SalesOrderPaymentTermsService,
        SalesOrderAdvanceReceiptService,
        AccountsCommercialApprovalService,
        { provide: PrismaService, useFactory: () => fake.root() },
      ],
    })
      // The real JwtAuthGuard rejects a request that carries no valid token
      // with 401; the stand-in does the same and otherwise supplies the user.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          if (!user) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest().user = user;
          return true;
        },
      })
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
    // One listening server shared by every request, so many requests can be
    // in flight at once in the concurrency tests.
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  const resetData = () => {
    fake.orders.clear();
    fake.receipts.clear();
    fake.approvals.length = 0;
    fake.terms.length = 0;
    fake.events.length = 0;
    fake.prs.length = 0;
    fake.proformas.clear();
    fake.items.clear();
    fake.seller.clear();
    fake.buyer.clear();
    fake.users.clear();
    fake.stripCas = false;
    fake.noProformaLock = false;
    fake.failRequisition = false;
    fake.users.set(USER_1, { id: USER_1, fullName: 'Asha Accounts' });
    fake.users.set(USER_2, { id: USER_2, fullName: 'Ravi Reviewer' });
    fake.proformas.set(PROFORMA, {
      id: PROFORMA,
      customerStatus: 'APPROVED',
      totalAmount: 275000,
    });
    fake.proformas.set(PROFORMA_DUP, {
      id: PROFORMA_DUP,
      customerStatus: 'APPROVED',
      totalAmount: 250000,
    });
    fake.proformas.set(PROFORMA_PENDING, {
      id: PROFORMA_PENDING,
      customerStatus: 'PENDING',
      totalAmount: 100000,
    });
    fake.items.set(ITEM, { id: ITEM, availableQty: 100 });
    fake.seller.set(SELLER, { id: SELLER, stateCode: '27' });
    fake.buyer.set(BUYER, {
      id: BUYER,
      stateCode: '24',
      stateName: 'Gujarat',
    });
  };

  const seedOrder = (id: string, status: string, extra: any = {}) =>
    fake.orders.set(id, {
      id,
      status,
      totalAmount: 275000,
      createdAt: new Date(),
      ...extra,
    });
  const seedReceipt = (
    id: string,
    salesOrderId: string,
    verificationStatus = 'PENDING',
  ) =>
    fake.receipts.set(id, {
      id,
      salesOrderId,
      verificationStatus,
      remarks: 'Received at the bank',
      verifiedBy: null,
      verifiedAt: null,
    });

  beforeEach(() => {
    resetData();
    user = { id: USER_1, permissions: ALL };
  });

  const http = () => request(app.getHttpServer());
  const verify = (id: string, body: unknown) =>
    http()
      .patch(`/sales-order-advance-receipt/${id}/verify`)
      .send(body as object);
  const approve = (body: unknown) =>
    http()
      .post('/accounts-commercial-approval/create')
      .send(body as object);
  const createOrder = (body: unknown) =>
    http()
      .post('/sales-orders')
      .send(body as object);
  const validOrder = {
    proformaInvoiceId: PROFORMA,
    orderDate: '2026-10-06',
    inventoryItemId: ITEM,
    orderQty: 10,
    sellerGstId: SELLER,
    buyerGstId: BUYER,
  };
  const eventsOf = (id: string) =>
    fake.events.filter((e) => e.salesOrderId === id);

  // -------------------------------------------------------------------------
  describe('transition rules', () => {
    it('allow exactly the two RevenueOS steps and nothing else', () => {
      expect(SALES_ORDER_TRANSITIONS).toEqual({
        PENDING_STORE_APPROVAL: ['PENDING_ACCOUNTS_APPROVAL'],
        PENDING_ACCOUNTS_APPROVAL: ['READY_FOR_DISPATCH_ORDER'],
      });
      const all = [
        'OPEN',
        'PENDING_STORE_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL',
        'READY_FOR_DISPATCH_ORDER',
        'DISPATCH_ORDER_CREATED',
        'READY_FOR_INVOICING',
        'CANCELLED',
      ];
      const allowed = all.flatMap((f) =>
        all
          .filter((t) => isSalesOrderTransitionAllowed(f, t))
          .map((t) => `${f}>${t}`),
      );
      expect(allowed).toEqual([
        'PENDING_STORE_APPROVAL>PENDING_ACCOUNTS_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL>READY_FOR_DISPATCH_ORDER',
      ]);
    });

    it('refuses to skip, reverse or repeat a step, and has no cancel or reject status', () => {
      expect(() =>
        assertSalesOrderTransition(
          'PENDING_STORE_APPROVAL',
          'READY_FOR_DISPATCH_ORDER',
        ),
      ).toThrow();
      expect(() =>
        assertSalesOrderTransition(
          'PENDING_ACCOUNTS_APPROVAL',
          'PENDING_STORE_APPROVAL',
        ),
      ).toThrow();
      expect(() =>
        assertSalesOrderTransition(
          'PENDING_STORE_APPROVAL',
          'PENDING_STORE_APPROVAL',
        ),
      ).toThrow();
      expect(Object.values(SALES_ORDER_STATUS)).toEqual([
        'PENDING_STORE_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL',
        'READY_FOR_DISPATCH_ORDER',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('guards: authentication and permissions', () => {
    const codesInSeed = [
      ...fs
        .readFileSync(
          path.join(
            root,
            'prisma/manual-migrations/20261006_crm_sales_order_permissions.sql',
          ),
          'utf8',
        )
        .matchAll(/\('(salesorders\.[a-z.]+)',/g),
    ].map((m) => m[1]);

    const controllers: any[] = [
      SalesOrdersController,
      SalesOrderPaymentTermsController,
      SalesOrderAdvanceReceiptController,
      AccountsCommercialApprovalController,
    ];

    it.each(controllers.map((c) => [c.name, c]))(
      '%s has JwtAuthGuard and PermissionsGuard',
      (_n, controller) => {
        const guards: any[] = Reflect.getMetadata('__guards__', controller);
        expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
      },
    );

    it.each(controllers.map((c) => [c.name, c]))(
      '%s: every route declares a permission that exists in the seed (an undeclared route would be open to any signed-in user)',
      (_n, controller) => {
        const routes = Object.getOwnPropertyNames(controller.prototype).filter(
          (k) => k !== 'constructor',
        );
        expect(routes.length).toBeGreaterThan(0);
        for (const route of routes) {
          const perms: string[] | undefined = Reflect.getMetadata(
            'permissions',
            controller.prototype[route],
          );
          expect(perms).toBeDefined();
          expect(perms!.length).toBeGreaterThan(0);
          for (const p of perms!) expect(codesInSeed).toContain(p);
        }
      },
    );

    const routes: Array<[string, string, string, () => request.Test]> = [
      [
        'POST /sales-orders',
        'salesorders.create',
        'salesorders.view',
        () => createOrder(validOrder),
      ],
      [
        'GET /sales-orders',
        'salesorders.view',
        'salesorders.create',
        () => http().get('/sales-orders'),
      ],
      [
        'GET /sales-orders/:id/events',
        'salesorders.view',
        'salesorders.create',
        () => http().get(`/sales-orders/${ORDER}/events`),
      ],
      [
        'POST /sales-order-payment-terms/create',
        'salesorders.paymentterms.create',
        'salesorders.paymentterms.view',
        () =>
          http().post('/sales-order-payment-terms/create').send({
            salesOrderId: ORDER,
            paymentType: 'CREDIT',
            advanceAmount: 0,
            balanceAmount: 1,
          }),
      ],
      [
        'GET /sales-order-payment-terms',
        'salesorders.paymentterms.view',
        'salesorders.paymentterms.create',
        () => http().get('/sales-order-payment-terms'),
      ],
      [
        'POST /sales-order-advance-receipt/create',
        'salesorders.advancereceipts.create',
        'salesorders.advancereceipts.view',
        () =>
          http().post('/sales-order-advance-receipt/create').send({
            salesOrderId: ORDER,
            receiptDate: '2026-10-06',
            amountReceived: 1,
            paymentMode: 'UPI',
          }),
      ],
      [
        'GET /sales-order-advance-receipt',
        'salesorders.advancereceipts.view',
        'salesorders.advancereceipts.create',
        () => http().get('/sales-order-advance-receipt'),
      ],
      [
        'PATCH /sales-order-advance-receipt/:id/verify',
        'salesorders.advancereceipts.verify',
        'salesorders.advancereceipts.create',
        () => verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
      ],
      [
        'POST /accounts-commercial-approval/create',
        'salesorders.commercialapproval.approve',
        'salesorders.commercialapproval.view',
        () => approve({ salesOrderId: ORDER }),
      ],
      [
        'GET /accounts-commercial-approval',
        'salesorders.commercialapproval.view',
        'salesorders.commercialapproval.approve',
        () => http().get('/accounts-commercial-approval'),
      ],
    ];

    it.each(routes)(
      '%s -> 401 without a signed-in user, and nothing is written',
      async (_n, _need, _wrong, call) => {
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
        seedReceipt(RECEIPT, ORDER);
        user = null;
        const res = await call();
        expect(res.status).toBe(401);
        expect(fake.events).toEqual([]);
        expect(fake.approvals).toEqual([]);
        expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
        expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
      },
    );

    it.each(routes)(
      '%s -> 403 with no permissions, or with only a related one, and nothing is written',
      async (_n, _need, wrong, call) => {
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
        seedReceipt(RECEIPT, ORDER);
        for (const permissions of [
          [],
          [wrong],
          ALL.filter((p) => p !== _need),
        ]) {
          user = { id: USER_1, permissions };
          const res = await call();
          expect(res.status).toBe(403);
        }
        expect(fake.events).toEqual([]);
        expect(fake.approvals).toEqual([]);
        expect(fake.orders.size).toBe(1);
        expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
      },
    );

    it.each(routes)(
      '%s gets past the guards with exactly its own permission',
      async (_n, need, _wrong, call) => {
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
        seedReceipt(RECEIPT, ORDER);
        user = { id: USER_1, permissions: [need] };
        const res = await call();
        // The request may still be refused by the business rules (for example
        // approving an order that is not waiting), but never by the guards.
        expect([401, 403]).not.toContain(res.status);
      },
    );
  });

  // -------------------------------------------------------------------------
  describe('advance receipt verification', () => {
    beforeEach(() => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
    });

    it('VERIFIED advances PENDING_STORE_APPROVAL -> PENDING_ACCOUNTS_APPROVAL and records the event', async () => {
      const res = await verify(RECEIPT, {
        verificationStatus: 'VERIFIED',
        remarks: '  Matches the bank statement  ',
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Advance payment verified/);
      expect(res.body.salesOrder).toEqual({
        id: ORDER,
        status: 'PENDING_ACCOUNTS_APPROVAL',
      });
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      expect(fake.receipts.get(RECEIPT)).toMatchObject({
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Asha Accounts',
      });
      expect(fake.receipts.get(RECEIPT).verifiedAt).toBeInstanceOf(Date);

      const events = eventsOf(ORDER);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        salesOrderId: ORDER,
        action: 'ADVANCE_RECEIPT_VERIFIED',
        result: 'VERIFIED',
        fromStatus: 'PENDING_STORE_APPROVAL',
        toStatus: 'PENDING_ACCOUNTS_APPROVAL',
        referenceId: RECEIPT,
        remarks: 'Matches the bank statement',
        actorId: USER_1,
      });
      expect(events[0].occurredAt).toBeInstanceOf(Date);
    });

    it('REJECTED does not advance the order, adds no new status, and is recorded as an event', async () => {
      const res = await verify(RECEIPT, {
        verificationStatus: 'REJECTED',
        remarks: 'Amount does not match',
      });
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/rejected/i);
      expect(res.body.salesOrder).toEqual({
        id: ORDER,
        status: 'PENDING_STORE_APPROVAL',
      });
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
      expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('REJECTED');

      const events = eventsOf(ORDER);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'ADVANCE_RECEIPT_REJECTED',
        result: 'REJECTED',
        fromStatus: 'PENDING_STORE_APPROVAL',
        toStatus: 'PENDING_STORE_APPROVAL',
        referenceId: RECEIPT,
        remarks: 'Amount does not match',
        actorId: USER_1,
      });
    });

    it('a rejected receipt leaves the order free to be advanced by a later verified one', async () => {
      seedReceipt(RECEIPT_B, ORDER);
      await verify(RECEIPT, { verificationStatus: 'REJECTED' });
      const res = await verify(RECEIPT_B, { verificationStatus: 'VERIFIED' });
      expect(res.status).toBe(200);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      expect(eventsOf(ORDER).map((e) => e.action)).toEqual([
        'ADVANCE_RECEIPT_REJECTED',
        'ADVANCE_RECEIPT_VERIFIED',
      ]);
    });

    it('records a rejection for an order in any status as "stayed at X", without moving it', async () => {
      for (const status of [
        'OPEN',
        'PENDING_ACCOUNTS_APPROVAL',
        'READY_FOR_DISPATCH_ORDER',
        'DISPATCH_ORDER_CREATED',
      ]) {
        resetData();
        seedOrder(ORDER, status);
        seedReceipt(RECEIPT, ORDER);
        const res = await verify(RECEIPT, { verificationStatus: 'REJECTED' });
        expect(res.status).toBe(200);
        expect(fake.orders.get(ORDER).status).toBe(status);
        expect(eventsOf(ORDER)[0]).toMatchObject({
          fromStatus: status,
          toStatus: status,
        });
      }
    });

    it('stores optional remarks on the event only: the receipt keeps its own remarks and none go anywhere else', async () => {
      await verify(RECEIPT, {
        verificationStatus: 'VERIFIED',
        remarks: 'Checked with the bank',
      });
      expect(fake.receipts.get(RECEIPT).remarks).toBe('Received at the bank');
      expect(eventsOf(ORDER)[0].remarks).toBe('Checked with the bank');
      expect(fake.approvals).toEqual([]);
    });

    it('works without remarks (remarks are optional)', async () => {
      const res = await verify(RECEIPT, { verificationStatus: 'VERIFIED' });
      expect(res.status).toBe(200);
      expect(eventsOf(ORDER)[0].remarks).toBeUndefined();
    });

    it.each([
      'OPEN',
      'PENDING_ACCOUNTS_APPROVAL',
      'READY_FOR_DISPATCH_ORDER',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
    ])(
      'VERIFIED on an order in %s -> 409, and the receipt stays PENDING with no event',
      async (status) => {
        seedOrder(ORDER, status);
        const res = await verify(RECEIPT, { verificationStatus: 'VERIFIED' });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(
          /not waiting for advance payment verification/,
        );
        expect(fake.orders.get(ORDER).status).toBe(status);
        expect(fake.receipts.get(RECEIPT)).toMatchObject({
          verificationStatus: 'PENDING',
          verifiedBy: null,
          verifiedAt: null,
        });
        expect(fake.events).toEqual([]);
      },
    );

    it('an already decided receipt cannot be decided again (409), and nothing changes', async () => {
      await verify(RECEIPT, { verificationStatus: 'REJECTED' });
      const eventsBefore = fake.events.length;
      for (const verificationStatus of ['VERIFIED', 'REJECTED']) {
        const res = await verify(RECEIPT, { verificationStatus });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already been decided \(rejected\)/);
      }
      expect(fake.events).toHaveLength(eventsBefore);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
    });

    it('an unknown receipt -> 404', async () => {
      const res = await verify(uid(999), { verificationStatus: 'VERIFIED' });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Advance receipt not found.');
      expect(fake.events).toEqual([]);
    });

    it.each([
      ['PENDING', { verificationStatus: 'PENDING' }],
      ['UNDER_REVIEW', { verificationStatus: 'UNDER_REVIEW' }],
      ['an unknown state', { verificationStatus: 'APPROVED' }],
      ['lowercase', { verificationStatus: 'verified' }],
      ['no status', {}],
      [
        'a client-named verifier',
        { verificationStatus: 'VERIFIED', verifiedBy: 'Someone Else' },
      ],
      [
        'a client-supplied actor',
        { verificationStatus: 'VERIFIED', actorId: USER_2 },
      ],
      [
        'a client-supplied order status',
        { verificationStatus: 'VERIFIED', status: 'READY_FOR_DISPATCH_ORDER' },
      ],
      [
        'remarks over the limit',
        { verificationStatus: 'VERIFIED', remarks: 'x'.repeat(501) },
      ],
    ])('rejects %s with 400 and changes nothing', async (_n, body) => {
      const res = await verify(RECEIPT, body);
      expect(res.status).toBe(400);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
      expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
      expect(fake.events).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('actor attribution', () => {
    it('the event actor and the legacy name come from req.user, never from the request', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      user = { id: USER_2, permissions: ALL };
      await verify(RECEIPT, { verificationStatus: 'VERIFIED' });
      expect(eventsOf(ORDER)[0].actorId).toBe(USER_2);
      expect(fake.receipts.get(RECEIPT).verifiedBy).toBe('Ravi Reviewer');

      user = { id: USER_1, permissions: ALL };
      await approve({ salesOrderId: ORDER });
      expect(eventsOf(ORDER)[1].actorId).toBe(USER_1);
      expect(fake.approvals[0].approvedBy).toBe('Asha Accounts');
    });

    it('a request that names a different verifier or approver is refused outright', async () => {
      seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      expect(
        (
          await verify(RECEIPT, {
            verificationStatus: 'VERIFIED',
            verifiedBy: 'X',
          })
        ).status,
      ).toBe(400);
      expect(
        (await approve({ salesOrderId: ORDER, approvedBy: 'X' })).status,
      ).toBe(400);
      expect(
        (await approve({ salesOrderId: ORDER, actorId: USER_2 })).status,
      ).toBe(400);
      expect(fake.events).toEqual([]);
    });

    it('a token without a user id, or for a user that no longer exists -> 401, nothing changes', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      for (const u of [
        { permissions: ALL },
        { id: 'ghost', permissions: ALL },
      ]) {
        user = u;
        expect(
          (await verify(RECEIPT, { verificationStatus: 'VERIFIED' })).status,
        ).toBe(401);
        seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
        expect((await approve({ salesOrderId: ORDER })).status).toBe(401);
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      }
      expect(fake.events).toEqual([]);
      expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
    });
  });

  // -------------------------------------------------------------------------
  describe('accounts commercial approval', () => {
    it('PENDING_ACCOUNTS_APPROVAL -> READY_FOR_DISPATCH_ORDER, with the approval record and event', async () => {
      seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
      const res = await approve({
        salesOrderId: ORDER,
        remarks: '  Terms confirmed  ',
      });
      expect(res.status).toBe(201);
      expect(res.body.message).toMatch(/completed successfully/);
      expect(res.body.salesOrder).toEqual({
        id: ORDER,
        status: 'READY_FOR_DISPATCH_ORDER',
      });
      expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
      expect(fake.approvals).toHaveLength(1);
      expect(fake.approvals[0]).toMatchObject({
        salesOrderId: ORDER,
        approvedBy: 'Asha Accounts',
        remarks: 'Terms confirmed',
      });
      const events = eventsOf(ORDER);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: 'ACCOUNTS_APPROVED',
        result: 'APPROVED',
        fromStatus: 'PENDING_ACCOUNTS_APPROVAL',
        toStatus: 'READY_FOR_DISPATCH_ORDER',
        referenceId: fake.approvals[0].id,
        remarks: 'Terms confirmed',
        actorId: USER_1,
      });
    });

    it.each([
      'OPEN',
      'PENDING_STORE_APPROVAL',
      'READY_FOR_DISPATCH_ORDER',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
    ])(
      'an order in %s cannot be approved (409), and no approval or event is left',
      async (status) => {
        seedOrder(ORDER, status);
        const res = await approve({ salesOrderId: ORDER });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(
          /not waiting for Accounts Commercial Approval/,
        );
        expect(fake.orders.get(ORDER).status).toBe(status);
        expect(fake.approvals).toEqual([]);
        expect(fake.events).toEqual([]);
      },
    );

    it('an unknown Sales Order -> 404', async () => {
      const res = await approve({ salesOrderId: uid(999) });
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Sales Order not found.');
      expect(fake.approvals).toEqual([]);
    });

    it.each([
      ['an id that is not a UUID', { salesOrderId: 'so-1' }],
      ['no order id', {}],
      [
        'remarks over the limit',
        { salesOrderId: ORDER, remarks: 'x'.repeat(501) },
      ],
      ['a client-supplied status', { salesOrderId: ORDER, status: 'APPROVED' }],
    ])('rejects %s with 400', async (_n, body) => {
      seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
      expect((await approve(body)).status).toBe(400);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      expect(fake.approvals).toEqual([]);
    });

    it('cannot approve twice, and cannot verify an advance after approval', async () => {
      seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      expect((await approve({ salesOrderId: ORDER })).status).toBe(201);
      expect((await approve({ salesOrderId: ORDER })).status).toBe(409);
      expect(
        (await verify(RECEIPT, { verificationStatus: 'VERIFIED' })).status,
      ).toBe(409);
      expect(fake.approvals).toHaveLength(1);
      expect(eventsOf(ORDER)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('the whole pre-dispatch path, with its history', () => {
    it('create -> verify -> approve gives the three statuses and a readable, attributed history', async () => {
      user = { id: USER_1, permissions: ALL };
      const created = await createOrder(validOrder);
      expect(created.status).toBe(201);
      const id = created.body.id;
      expect(fake.orders.get(id).status).toBe('PENDING_STORE_APPROVAL');

      const receipt = await http()
        .post('/sales-order-advance-receipt/create')
        .send({
          salesOrderId: id,
          receiptDate: '2026-10-06',
          amountReceived: 100000,
          paymentMode: 'BANK_TRANSFER',
        });
      expect(receipt.status).toBe(201);

      user = { id: USER_2, permissions: ALL };
      expect(
        (await verify(receipt.body.id, { verificationStatus: 'VERIFIED' }))
          .status,
      ).toBe(200);
      user = { id: USER_1, permissions: ALL };
      expect(
        (await approve({ salesOrderId: id, remarks: 'Cleared' })).status,
      ).toBe(201);
      expect(fake.orders.get(id).status).toBe('READY_FOR_DISPATCH_ORDER');

      const history = await http().get(`/sales-orders/${id}/events`);
      expect(history.status).toBe(200);
      expect(
        history.body.map((e: any) => [e.action, e.actor.fullName]),
      ).toEqual([
        ['ACCOUNTS_APPROVED', 'Asha Accounts'],
        ['ADVANCE_RECEIPT_VERIFIED', 'Ravi Reviewer'],
      ]);
      expect(Object.keys(history.body[0].actor).sort()).toEqual([
        'fullName',
        'id',
      ]);
      expect(history.body[0].remarks).toBe('Cleared');
    });

    it('the events endpoint is 404 for an unknown order and empty for an order without events', async () => {
      expect(
        (await http().get(`/sales-orders/${uid(999)}/events`)).status,
      ).toBe(404);
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      const res = await http().get(`/sales-orders/${ORDER}/events`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('creating payment terms and receipts does not write lifecycle events', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      const terms = await http()
        .post('/sales-order-payment-terms/create')
        .send({
          salesOrderId: ORDER,
          paymentType: 'PARTIAL_ADVANCE',
          advanceAmount: 100000,
          balanceAmount: 175000,
          dueDate: '2026-11-05',
          remarks: 'Balance on delivery',
        });
      expect(terms.status).toBe(201);
      expect(fake.terms[0]).toMatchObject({
        salesOrderId: ORDER,
        paymentType: 'PARTIAL_ADVANCE',
      });
      expect(fake.terms[0].dueDate).toBeInstanceOf(Date);
      await http().post('/sales-order-advance-receipt/create').send({
        salesOrderId: ORDER,
        receiptDate: '2026-10-06',
        amountReceived: 100000,
        paymentMode: 'UPI',
      });
      expect(fake.events).toEqual([]);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
    });

    it('payment terms and receipts for an unknown order -> 404, not a server error', async () => {
      const t = await http()
        .post('/sales-order-payment-terms/create')
        .send({
          salesOrderId: uid(999),
          paymentType: 'CREDIT',
          advanceAmount: 0,
          balanceAmount: 1,
        });
      expect(t.status).toBe(404);
      const r = await http()
        .post('/sales-order-advance-receipt/create')
        .send({
          salesOrderId: uid(999),
          receiptDate: '2026-10-06',
          amountReceived: 1,
          paymentMode: 'UPI',
        });
      expect(r.status).toBe(404);
      expect(fake.terms).toEqual([]);
      expect(fake.receipts.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('creating a Sales Order', () => {
    it('derives the total from the approved Proforma (no client total needed) and starts at PENDING_STORE_APPROVAL', async () => {
      const res = await createOrder(validOrder);
      expect(res.status).toBe(201);
      expect(res.body.totalAmount).toBe(275000);
      expect(res.body.status).toBe('PENDING_STORE_APPROVAL');
      expect(res.body.taxType).toBe('IGST');
      expect(res.body.placeOfSupply).toBe('Gujarat');
      expect(fake.orders.get(res.body.id).totalAmount).toBe(275000);
    });

    it('accepts a client total only when it matches the Proforma, and never stores a different one', async () => {
      expect(
        (await createOrder({ ...validOrder, totalAmount: 275000 })).status,
      ).toBe(201);
      resetData();
      const res = await createOrder({ ...validOrder, totalAmount: 1 });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(
        /must match the approved Proforma Invoice \(275000\)/,
      );
      expect(fake.orders.size).toBe(0);
    });

    it('does not recalculate tax: the Proforma total is used as it is', async () => {
      fake.proformas.get(PROFORMA).totalAmount = 323950.5;
      const res = await createOrder(validOrder);
      expect(res.body.totalAmount).toBe(323950.5);
    });

    it('uses CGST_SGST when seller and buyer are in the same state', async () => {
      fake.buyer.get(BUYER).stateCode = '27';
      const res = await createOrder(validOrder);
      expect(res.body.taxType).toBe('CGST_SGST');
    });

    it('refuses a second Sales Order for the same Proforma (409) and changes nothing', async () => {
      const first = await createOrder(validOrder);
      expect(first.status).toBe(201);
      const again = await createOrder(validOrder);
      expect(again.status).toBe(409);
      expect(again.body.message).toBe(
        'A Sales Order already exists for this Proforma Invoice.',
      );
      expect(fake.orders.size).toBe(1);
      expect([...fake.orders.values()][0].id).toBe(first.body.id);
    });

    it('allows a different Proforma, and leaves existing duplicates exactly as they were', async () => {
      const dupA = {
        id: uid(61),
        proformaInvoiceId: PROFORMA_DUP,
        status: 'OPEN',
        totalAmount: 250000,
      };
      const dupB = {
        id: uid(62),
        proformaInvoiceId: PROFORMA_DUP,
        status: 'OPEN',
        totalAmount: 250000,
      };
      fake.orders.set(dupA.id, { ...dupA });
      fake.orders.set(dupB.id, { ...dupB });
      const before = JSON.stringify([...fake.orders.values()]);

      // a third order for the already-duplicated Proforma is refused
      expect(
        (await createOrder({ ...validOrder, proformaInvoiceId: PROFORMA_DUP }))
          .status,
      ).toBe(409);
      expect(JSON.stringify([...fake.orders.values()])).toBe(before);

      // a Proforma that has no order yet is fine, and the duplicates are untouched
      expect((await createOrder(validOrder)).status).toBe(201);
      expect(fake.orders.get(dupA.id)).toEqual(dupA);
      expect(fake.orders.get(dupB.id)).toEqual(dupB);
    });

    it('requires an APPROVED Proforma (409) and an existing one (404)', async () => {
      const pending = await createOrder({
        ...validOrder,
        proformaInvoiceId: PROFORMA_PENDING,
      });
      expect(pending.status).toBe(409);
      expect(pending.body.message).toBe(
        'Sales Order can only be created from APPROVED Proforma Invoice',
      );
      const missing = await createOrder({
        ...validOrder,
        proformaInvoiceId: uid(998),
      });
      expect(missing.status).toBe(404);
      expect(fake.orders.size).toBe(0);
    });

    it('reports a missing inventory item or GST registration as 404', async () => {
      expect(
        (await createOrder({ ...validOrder, inventoryItemId: uid(997) }))
          .status,
      ).toBe(404);
      expect(
        (await createOrder({ ...validOrder, sellerGstId: uid(996) })).status,
      ).toBe(404);
      expect(
        (await createOrder({ ...validOrder, buyerGstId: uid(995) })).status,
      ).toBe(404);
      expect(fake.orders.size).toBe(0);
    });

    it('creates the purchase requisition for a stock shortage together with the order', async () => {
      fake.items.get(ITEM).availableQty = 4;
      const res = await createOrder({ ...validOrder, orderQty: 10 });
      expect(res.status).toBe(201);
      expect(fake.prs).toHaveLength(1);
      expect(fake.prs[0]).toMatchObject({
        salesOrderId: res.body.id,
        inventoryItemId: ITEM,
        requestedQty: 6,
      });
    });

    it('creates no requisition when stock is enough', async () => {
      await createOrder(validOrder);
      expect(fake.prs).toEqual([]);
    });

    it('if the requisition cannot be written, no order is left behind', async () => {
      fake.items.get(ITEM).availableQty = 0;
      fake.failRequisition = true;
      const res = await createOrder(validOrder);
      expect(res.status).toBe(500);
      expect(fake.orders.size).toBe(0);
      fake.failRequisition = false;
      expect((await createOrder(validOrder)).status).toBe(201);
    });

    it.each([
      ['a proforma id that is not a UUID', { proformaInvoiceId: 'p' }],
      ['a negative client total', { totalAmount: -5 }],
      ['a zero quantity', { orderQty: 0 }],
      ['a garbage date', { orderDate: 'tomorrow' }],
      ['a client-supplied status', { status: 'READY_FOR_DISPATCH_ORDER' }],
    ])('rejects %s with 400', async (_n, patch) => {
      expect((await createOrder({ ...validOrder, ...patch })).status).toBe(400);
      expect(fake.orders.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('concurrency', () => {
    const settle = (calls: request.Test[]) => Promise.all(calls);
    const statuses = (rs: Array<{ status: number }>) =>
      rs.map((r) => r.status).sort();

    it('10 simultaneous verifications of one receipt: exactly one succeeds, the order advances once', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      const rs = await settle(
        Array.from({ length: 10 }, () =>
          verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
        ),
      );
      expect(statuses(rs)).toEqual([200, ...Array(9).fill(409)]);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      expect(eventsOf(ORDER)).toHaveLength(1);
    });

    it('verify and reject of the same receipt at once: exactly one decision is recorded', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      const rs = await settle([
        verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
        verify(RECEIPT, { verificationStatus: 'REJECTED' }),
        verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
        verify(RECEIPT, { verificationStatus: 'REJECTED' }),
      ]);
      expect(statuses(rs)).toEqual([200, 409, 409, 409]);
      expect(eventsOf(ORDER)).toHaveLength(1);
      const decided = fake.receipts.get(RECEIPT).verificationStatus;
      expect(eventsOf(ORDER)[0].result).toBe(decided);
      expect(fake.orders.get(ORDER).status).toBe(
        decided === 'VERIFIED'
          ? 'PENDING_ACCOUNTS_APPROVAL'
          : 'PENDING_STORE_APPROVAL',
      );
    });

    it('two different receipts verified at once: the order advances once; the loser is rolled back and stays PENDING', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      seedReceipt(RECEIPT_B, ORDER);
      const rs = await settle([
        verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
        verify(RECEIPT_B, { verificationStatus: 'VERIFIED' }),
      ]);
      expect(statuses(rs)).toEqual([200, 409]);
      const states = [
        fake.receipts.get(RECEIPT),
        fake.receipts.get(RECEIPT_B),
      ].map((r) => r.verificationStatus);
      expect(states.sort()).toEqual(['PENDING', 'VERIFIED']);
      expect(eventsOf(ORDER)).toHaveLength(1);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      const loser = [
        fake.receipts.get(RECEIPT),
        fake.receipts.get(RECEIPT_B),
      ].find((r) => r.verificationStatus === 'PENDING');
      expect(loser.verifiedBy).toBeNull();
      expect(loser.verifiedAt).toBeNull();
    });

    it('10 simultaneous approvals: exactly one succeeds, one approval and one event', async () => {
      seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
      const rs = await settle(
        Array.from({ length: 10 }, () => approve({ salesOrderId: ORDER })),
      );
      expect(statuses(rs)).toEqual([201, ...Array(9).fill(409)]);
      expect(fake.approvals).toHaveLength(1);
      expect(eventsOf(ORDER)).toHaveLength(1);
      expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
    });

    it('10 simultaneous creates for one Proforma: exactly one order', async () => {
      const rs = await settle(
        Array.from({ length: 10 }, () => createOrder(validOrder)),
      );
      expect(statuses(rs)).toEqual([201, ...Array(9).fill(409)]);
      expect(fake.orders.size).toBe(1);
    });

    it('simultaneous creates for different Proformas do not block each other', async () => {
      const rs = await settle([
        createOrder(validOrder),
        createOrder({ ...validOrder, proformaInvoiceId: PROFORMA_DUP }),
      ]);
      expect(statuses(rs)).toEqual([201, 201]);
      expect(fake.orders.size).toBe(2);
    });

    describe('negative controls: with the protection removed the same tests catch the race', () => {
      it('without the status condition, many verifications all "succeed" and write many events', async () => {
        fake.stripCas = true;
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
        seedReceipt(RECEIPT, ORDER);
        const rs = await settle(
          Array.from({ length: 10 }, () =>
            verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
          ),
        );
        expect(rs.filter((r) => r.status === 200).length).toBeGreaterThan(1);
        expect(eventsOf(ORDER).length).toBeGreaterThan(1);
      });

      it('without the status condition, an order is approved more than once', async () => {
        fake.stripCas = true;
        seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
        const rs = await settle(
          Array.from({ length: 10 }, () => approve({ salesOrderId: ORDER })),
        );
        expect(rs.filter((r) => r.status === 201).length).toBeGreaterThan(1);
        expect(fake.approvals.length).toBeGreaterThan(1);
      });

      it('without the Proforma row lock, duplicate orders are created', async () => {
        fake.noProformaLock = true;
        const rs = await settle(
          Array.from({ length: 10 }, () => createOrder(validOrder)),
        );
        expect(rs.filter((r) => r.status === 201).length).toBeGreaterThan(1);
        expect(fake.orders.size).toBeGreaterThan(1);
      });
    });
  });
});
