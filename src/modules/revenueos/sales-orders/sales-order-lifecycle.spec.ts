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
import { SalesReportsService } from '../sales-reports/sales-reports.service';
import {
  SALES_ORDER_CANCELLABLE_STATUSES,
  SALES_ORDER_RETRACTIONS,
  SALES_ORDER_STATUS,
  SALES_ORDER_TRANSITIONS,
  assertSalesOrderCancellation,
  assertSalesOrderRetraction,
  assertSalesOrderTransition,
  canRecordSalesOrderDocuments,
  isSalesOrderCancellationAllowed,
  isSalesOrderRetractionAllowed,
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
  'salesorders.advancereceipts.retract',
  'salesorders.commercialapproval.retract',
  'salesorders.cancel',
];

const root = path.resolve(__dirname, '../../../..');

// ---------------------------------------------------------------------------
// A stateful fake of the database the lifecycle code uses. It keeps real
// compare-and-set semantics for updateMany, real transaction rollback (an undo
// journal per transaction, so interleaved transactions do not disturb each
// other) and PostgreSQL's row-lock rules: FOR KEY SHARE (taken by the foreign
// key check of a row being inserted), FOR SHARE, FOR NO KEY UPDATE (taken by
// an UPDATE that does not touch a key) and FOR UPDATE, with PostgreSQL's
// conflict matrix, held until the transaction ends. A statement that has to
// wait re-checks its WHERE condition once it gets the lock, as READ COMMITTED
// does. Flags switch protections off for the negative controls.
// ---------------------------------------------------------------------------
type LockMode = 'KEY_SHARE' | 'SHARE' | 'NO_KEY_UPDATE' | 'UPDATE';

const LOCK_CONFLICTS: Record<LockMode, LockMode[]> = {
  KEY_SHARE: ['UPDATE'],
  SHARE: ['NO_KEY_UPDATE', 'UPDATE'],
  NO_KEY_UPDATE: ['SHARE', 'NO_KEY_UPDATE', 'UPDATE'],
  UPDATE: ['KEY_SHARE', 'SHARE', 'NO_KEY_UPDATE', 'UPDATE'],
};

class FakeDb {
  orders = new Map<string, any>();
  receipts = new Map<string, any>();
  approvals: any[] = [];
  terms: any[] = [];
  events: any[] = [];
  prs: any[] = [];
  purchaseOrders: any[] = [];
  reservations: any[] = [];
  dispatchOrders: any[] = [];
  dispatches: any[] = [];
  invoices: any[] = [];
  proformas = new Map<string, any>();
  quotations = new Map<string, any>();
  items = new Map<string, any>();
  seller = new Map<string, any>();
  buyer = new Map<string, any>();
  users = new Map<string, any>();
  seq = 100;
  clock = 0; // orders every write, so "written after the cancellation" is checkable
  stripCas = false; // negative control: ignore the status condition of updateMany
  noProformaLock = false; // negative control: no row lock on the Proforma
  noOrderLock = false; // negative control: lockSalesOrder (FOR UPDATE) takes no lock
  noSharedLock = false; // negative control: readSalesOrderStatusShared (FOR SHARE) takes no lock
  failRequisition = false;
  failEvents = false; // the next event write throws, to prove nothing is half-saved
  gates: Record<string, () => Promise<void>> = {};
  private held = new Map<symbol, Array<{ key: string; mode: LockMode }>>();
  private holders = new Map<string, Array<{ owner: symbol; mode: LockMode }>>();

  nextId() {
    this.seq += 1;
    return uid(this.seq);
  }

  tickClock() {
    this.clock += 1;
    return this.clock;
  }

  // Waits until no other owner holds a conflicting lock on the key, then holds
  // the lock until releaseOwner(). Gives up loudly on a real deadlock.
  async lock(owner: symbol, key: string, mode: LockMode) {
    for (let spin = 0; ; spin += 1) {
      const others = (this.holders.get(key) ?? []).filter(
        (h) => h.owner !== owner,
      );
      if (!others.some((h) => LOCK_CONFLICTS[mode].includes(h.mode))) {
        const list = this.holders.get(key) ?? [];
        list.push({ owner, mode });
        this.holders.set(key, list);
        const mine = this.held.get(owner) ?? [];
        mine.push({ key, mode });
        this.held.set(owner, mine);
        return;
      }
      if (spin > 20000) throw new Error(`deadlock waiting for ${key}`);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  releaseOwner(owner: symbol) {
    for (const { key } of this.held.get(owner) ?? []) {
      const list = (this.holders.get(key) ?? []).filter(
        (h) => h.owner !== owner,
      );
      if (list.length) this.holders.set(key, list);
      else this.holders.delete(key);
    }
    this.held.delete(owner);
  }

  // What another service does when it inserts a row that points at a Sales
  // Order (a dispatch order, an invoice): the foreign-key check takes FOR KEY
  // SHARE on the order row at the moment of the insert and keeps it until that
  // transaction commits; the row itself becomes visible only at commit. It
  // waits for a FOR UPDATE holder. `inFlightMs` keeps the inserting transaction
  // open for a while, as a slow request would.
  async insertDownstream(
    kind: 'dispatchOrders' | 'dispatches' | 'invoices',
    salesOrderId: string,
    inFlightMs = 0,
  ) {
    const owner = Symbol(kind);
    await this.lock(owner, `order:${salesOrderId}`, 'KEY_SHARE');
    try {
      if (inFlightMs) await new Promise((r) => setTimeout(r, inFlightMs));
      const order = this.orders.get(salesOrderId);
      this.tickClock();
      const row = {
        id: this.nextId(),
        salesOrderId,
        seqNo: this.clock,
        orderStatusAtInsert: order?.status,
      };
      this[kind].push(row);
      return row;
    } finally {
      this.releaseOwner(owner);
    }
  }

  private match(row: any, where: any, casMode = false) {
    return Object.entries(where).every(([k, v]) => {
      if (
        casMode &&
        this.stripCas &&
        (k === 'status' || k === 'verificationStatus')
      )
        return true;
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const cond = v as any;
        if ('not' in cond) return row[k] !== cond.not;
        if ('notIn' in cond) return !cond.notIn.includes(row[k]);
        if ('in' in cond) return cond.in.includes(row[k]);
        return false;
      }
      return row[k] === v;
    });
  }

  private project(row: any, select?: any) {
    if (!row) return null;
    if (!select) return { ...row };
    return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
  }

  client(ctx: { owner: symbol; journal: Array<() => void> | null }): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const { owner } = ctx;
    const undo = (fn: () => void) => ctx.journal?.push(fn);
    const inTx = ctx.journal !== null;
    const gate = async (name: string) => {
      if (self.gates[name]) await self.gates[name]();
    };

    const stamp = (row: any) => {
      row.seqNo = self.tickClock();
      return row;
    };

    // UPDATE ... WHERE: each candidate row is locked (FOR NO KEY UPDATE) before
    // the condition is evaluated, so a statement that waited sees what the
    // transaction it waited for committed (or rolled back).
    const updateMany = (rows: () => any[], table: string) =>
      jest.fn(async (args: any) => {
        let count = 0;
        const candidates = rows().filter(
          (r) => args.where.id === undefined || r.id === args.where.id,
        );
        for (const row of candidates) {
          if (inTx)
            await self.lock(owner, `${table}:${row.id}`, 'NO_KEY_UPDATE');
          if (self.match(row, args.where, true)) {
            const before = { ...row };
            Object.assign(row, args.data);
            undo(() => Object.assign(row, before));
            count += 1;
          }
        }
        return { count };
      });

    const counter = (rows: () => any[], name: string) =>
      jest.fn(async (a: any) => {
        const n = rows().filter((r) => self.match(r, a.where)).length;
        await gate(name);
        return n;
      });

    const delegates: any = {
      salesOrder: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.orders.get(a.where.id), a.select),
        ),
        updateMany: updateMany(() => [...self.orders.values()], 'order'),
        count: jest.fn(
          async (a: any) =>
            [...self.orders.values()].filter((o) => self.match(o, a.where))
              .length,
        ),
        create: jest.fn(async (a: any) => {
          const row = stamp({
            id: self.nextId(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...a.data,
          });
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
        updateMany: updateMany(() => [...self.receipts.values()], 'receipt'),
        create: jest.fn(async (a: any) => {
          await gate('salesOrderAdvanceReceipt.create');
          const row = stamp({
            id: self.nextId(),
            verificationStatus: 'PENDING',
            verifiedBy: null,
            verifiedAt: null,
            createdAt: new Date(),
            ...a.data,
          });
          self.receipts.set(row.id, row);
          undo(() => self.receipts.delete(row.id));
          return { ...row };
        }),
        findMany: jest.fn(async () => [...self.receipts.values()]),
      },
      accountsCommercialApproval: {
        findUnique: jest.fn(async (a: any) =>
          self.project(
            self.approvals.find((x) => x.id === a.where.id),
            a.select,
          ),
        ),
        updateMany: updateMany(() => self.approvals, 'approval'),
        create: jest.fn(async (a: any) => {
          const row = stamp({
            id: self.nextId(),
            status: 'APPROVED',
            createdAt: new Date(),
            ...a.data,
          });
          self.approvals.push(row);
          undo(() => self.approvals.splice(self.approvals.indexOf(row), 1));
          return { ...row };
        }),
        findMany: jest.fn(async () => [...self.approvals]),
      },
      salesOrderPaymentTerm: {
        create: jest.fn(async (a: any) => {
          await gate('salesOrderPaymentTerm.create');
          const row = stamp({ id: self.nextId(), ...a.data });
          self.terms.push(row);
          undo(() => self.terms.splice(self.terms.indexOf(row), 1));
          return { ...row };
        }),
        findMany: jest.fn(async () => [...self.terms]),
      },
      salesOrderEvent: {
        create: jest.fn(async (a: any) => {
          if (self.failEvents) throw new Error('event write failed');
          const row = stamp({
            id: self.nextId(),
            createdAt: new Date(),
            source: undefined,
            ...a.data,
          });
          self.events.push(row);
          undo(() => self.events.splice(self.events.indexOf(row), 1));
          return { ...row };
        }),
        findFirst: jest.fn(async (a: any) =>
          self.project(
            self.events.find((e) => self.match(e, a.where)),
            a.select,
          ),
        ),
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
      quotation: {
        findUniqueOrThrow: jest.fn(async (a: any) => {
          const row = self.quotations.get(a.where.id);
          if (!row) throw new Error('quotation not found');
          return self.project(row, a.select);
        }),
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
          const row = { id: self.nextId(), status: 'PENDING', ...a.data };
          self.prs.push(row);
          undo(() => self.prs.splice(self.prs.indexOf(row), 1));
          return { ...row };
        }),
        count: counter(() => self.prs, 'purchaseRequisition.count'),
      },
      purchaseOrder: {
        count: jest.fn(async (a: any) => {
          const wanted = a.where.purchaseRequisition.salesOrderId;
          return self.purchaseOrders.filter(
            (po) =>
              self.prs.find((pr) => pr.id === po.purchaseRequisitionId)
                ?.salesOrderId === wanted,
          ).length;
        }),
      },
      inventoryReservation: {
        count: counter(() => self.reservations, 'inventoryReservation.count'),
      },
      dispatchOrder: {
        count: counter(() => self.dispatchOrders, 'dispatchOrder.count'),
      },
      dispatch: {
        count: counter(() => self.dispatches, 'dispatch.count'),
      },
      salesInvoice: {
        count: counter(() => self.invoices, 'salesInvoice.count'),
      },
      user: {
        findUnique: jest.fn(async (a: any) =>
          self.project(self.users.get(a.where.id), a.select),
        ),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, id: string) => {
        const sql = strings.join('?').replace(/\s+/g, ' ');
        if (sql.includes('"ProformaInvoice"') && sql.includes('FOR UPDATE')) {
          if (!self.noProformaLock && inTx) {
            await self.lock(owner, `proforma:${id}`, 'UPDATE');
          }
          return self.proformas.has(id) ? [{ id }] : [];
        }
        if (sql.includes('FROM "Quotation"') && sql.includes('FOR SHARE')) {
          if (inTx) await self.lock(owner, `quotation:${id}`, 'SHARE');
          const q = self.quotations.get(id);
          return q ? [{ status: q.status }] : [];
        }
        if (sql.includes('FROM "SalesOrder"')) {
          const forUpdate = sql.includes('FOR UPDATE');
          const forShare = sql.includes('FOR SHARE');
          if (!forUpdate && !forShare)
            throw new Error(`unlocked raw read: ${sql}`);
          const skip = forUpdate ? self.noOrderLock : self.noSharedLock;
          if (inTx && !skip) {
            await self.lock(
              owner,
              `order:${id}`,
              forUpdate ? 'UPDATE' : 'SHARE',
            );
          }
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
    const base = self.client({ owner: Symbol('root'), journal: null });
    return {
      ...base,
      $transaction: jest.fn(async (fn: any) => {
        const journal: Array<() => void> = [];
        const owner = Symbol('tx');
        const tx = self.client({ owner, journal });
        try {
          const result = await fn(tx);
          self.releaseOwner(owner);
          return result;
        } catch (err) {
          for (const u of journal.reverse()) u();
          self.releaseOwner(owner);
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
    fake.quotations.clear();
    fake.items.clear();
    fake.seller.clear();
    fake.buyer.clear();
    fake.users.clear();
    fake.purchaseOrders.length = 0;
    fake.reservations.length = 0;
    fake.dispatchOrders.length = 0;
    fake.dispatches.length = 0;
    fake.invoices.length = 0;
    fake.gates = {};
    fake.clock = 0;
    fake.stripCas = false;
    fake.noProformaLock = false;
    fake.noOrderLock = false;
    fake.noSharedLock = false;
    fake.failRequisition = false;
    fake.failEvents = false;
    fake.users.set(USER_1, { id: USER_1, fullName: 'Asha Accounts' });
    fake.users.set(USER_2, { id: USER_2, fullName: 'Ravi Reviewer' });
    // Every Proforma hangs off its own APPROVED Quotation with the same total.
    const seedProforma = (id: string, status: string, total: number) => {
      const quotationId = `quotation-of-${id}`;
      fake.quotations.set(quotationId, {
        id: quotationId,
        status: 'APPROVED',
        totalAmount: total,
      });
      fake.proformas.set(id, {
        id,
        quotationId,
        customerStatus: status,
        totalAmount: total,
        validityDate: null,
      });
    };
    seedProforma(PROFORMA, 'APPROVED', 275000);
    seedProforma(PROFORMA_DUP, 'APPROVED', 250000);
    seedProforma(PROFORMA_PENDING, 'PENDING', 100000);
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

    it('refuses to skip, reverse or repeat a forward step; CANCELLED is the only status beyond the three, and there is no reject status', () => {
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
        'CANCELLED',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('guards: authentication and permissions', () => {
    const codesInSeed = [
      'prisma/manual-migrations/20261006_crm_sales_order_permissions.sql',
      'prisma/manual-migrations/20261006_crm_sales_order_cancel_retract_permissions.sql',
    ].flatMap((file) =>
      [
        ...fs
          .readFileSync(path.join(root, file), 'utf8')
          .matchAll(/\('(salesorders\.[a-z.]+)',/g),
      ].map((m) => m[1]),
    );

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
        'PATCH /sales-order-advance-receipt/:id/retract-verification',
        'salesorders.advancereceipts.retract',
        'salesorders.advancereceipts.verify',
        () => retractVerification(RECEIPT, { reason: 'Entered in error' }),
      ],
      [
        'POST /accounts-commercial-approval/:id/retract',
        'salesorders.commercialapproval.retract',
        'salesorders.commercialapproval.approve',
        () => retractApproval(uid(51), { reason: 'Entered in error' }),
      ],
      [
        'POST /sales-orders/:id/cancel',
        'salesorders.cancel',
        'salesorders.create',
        () => cancel(ORDER, { reason: 'Entered in error' }),
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
      fake.quotations.get(`quotation-of-${PROFORMA}`).totalAmount = 323950.5;
      const res = await createOrder(validOrder);
      expect(res.body.totalAmount).toBe(323950.5);
    });

    describe('what the approved Proforma and its Quotation must still satisfy', () => {
      const QUOTE = `quotation-of-${PROFORMA}`;
      const startOfTodayUtc = () => {
        const n = new Date();
        return new Date(
          Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()),
        );
      };
      const daysFromToday = (d: number) =>
        new Date(startOfTodayUtc().getTime() + d * 86_400_000);

      it('refuses an expired Proforma (409) and creates nothing', async () => {
        fake.proformas.get(PROFORMA).validityDate = daysFromToday(-1);
        const res = await createOrder(validOrder);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/expired on \d{4}-\d{2}-\d{2}/);
        expect(fake.orders.size).toBe(0);
        expect(fake.prs).toHaveLength(0);
      });

      it('accepts a Proforma through the end of its validity date, and one with no validity date', async () => {
        fake.proformas.get(PROFORMA).validityDate = daysFromToday(0);
        expect((await createOrder(validOrder)).status).toBe(201);

        fake.orders.clear();
        fake.proformas.get(PROFORMA).validityDate = daysFromToday(30);
        expect((await createOrder(validOrder)).status).toBe(201);

        fake.orders.clear();
        fake.proformas.get(PROFORMA).validityDate = null;
        expect((await createOrder(validOrder)).status).toBe(201);
      });

      it.each(['DRAFT', 'REVISED', 'REJECTED'])(
        'refuses a Proforma whose Quotation is %s (409)',
        async (status) => {
          fake.quotations.get(QUOTE).status = status;
          const res = await createOrder(validOrder);
          expect(res.status).toBe(409);
          expect(res.body.message).toMatch(
            new RegExp(`Quotation is APPROVED \\(now ${status}\\)`),
          );
          expect(fake.orders.size).toBe(0);
        },
      );

      it("refuses a Proforma whose total no longer matches its Quotation's (409)", async () => {
        fake.quotations.get(QUOTE).totalAmount = 275000.02;
        const res = await createOrder(validOrder);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(
          /no longer matches its Quotation total/,
        );
        expect(fake.orders.size).toBe(0);
      });

      it('tolerates a paisa of floating-point difference and still uses the Proforma total', async () => {
        fake.quotations.get(QUOTE).totalAmount = 275000.01;
        const res = await createOrder(validOrder);
        expect(res.status).toBe(201);
        expect(res.body.totalAmount).toBe(275000);
      });

      it('takes a shared lock on the Quotation while the order is created', async () => {
        const locks: string[] = [];
        const original = fake.lock.bind(fake);
        fake.lock = async (...a: any[]) => {
          locks.push(`${a[1]}:${a[2]}`);
          return original(...a);
        };
        await createOrder(validOrder);
        fake.lock = original;
        expect(locks).toEqual([
          `proforma:${PROFORMA}:UPDATE`,
          `quotation:${QUOTE}:SHARE`,
        ]);
      });
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
  // =========================================================================
  // Retract and cancel
  // =========================================================================
  const retractVerification = (id: string, body: unknown) =>
    http()
      .patch(`/sales-order-advance-receipt/${id}/retract-verification`)
      .send(body as object);
  const retractApproval = (id: string, body: unknown) =>
    http()
      .post(`/accounts-commercial-approval/${id}/retract`)
      .send(body as object);
  const cancel = (id: string, body: unknown) =>
    http()
      .post(`/sales-orders/${id}/cancel`)
      .send(body as object);
  const REASON = { reason: 'Customer asked us to start again' };

  const seedApproval = (
    id: string,
    salesOrderId: string,
    status = 'APPROVED',
  ) =>
    fake.approvals.push({
      id,
      salesOrderId,
      status,
      approvedBy: 'Asha Accounts',
      remarks: null,
      createdAt: new Date(),
    });

  type Stage =
    | 'PENDING_STORE_APPROVAL'
    | 'PENDING_ACCOUNTS_APPROVAL'
    | 'READY_FOR_DISPATCH_ORDER';

  // Drives an order through the real endpoints, so the receipt, approval and
  // events are exactly what the workflow writes.
  const orderAt = async (
    stage: Stage,
    orderId = ORDER,
    receiptId = RECEIPT,
  ) => {
    seedOrder(orderId, 'PENDING_STORE_APPROVAL');
    seedReceipt(receiptId, orderId);
    if (stage === 'PENDING_STORE_APPROVAL') return { approvalId: undefined };
    const v = await verify(receiptId, { verificationStatus: 'VERIFIED' });
    expect(v.status).toBe(200);
    if (stage === 'PENDING_ACCOUNTS_APPROVAL') return { approvalId: undefined };
    const a = await approve({ salesOrderId: orderId });
    expect(a.status).toBe(201);
    return { approvalId: a.body.approval.id as string };
  };

  const snap = () =>
    JSON.stringify({
      orders: [...fake.orders.values()],
      receipts: [...fake.receipts.values()],
      approvals: fake.approvals,
      terms: fake.terms,
      events: fake.events,
      prs: fake.prs,
    });

  // The invariants every order must satisfy after any mix of actions.
  const expectConsistent = (orderId: string) => {
    const order = fake.orders.get(orderId);
    const evs = fake.events
      .filter((e) => e.salesOrderId === orderId)
      .sort((a, b) => a.seqNo - b.seqNo);

    // The event chain is gapless and ends at the order's current status.
    if (evs.length > 0) {
      let current = evs[0].fromStatus;
      for (const e of evs) {
        expect(e.fromStatus).toBe(current);
        current = e.toStatus;
        expect(e.actorId).toBeTruthy();
      }
      expect(order.status).toBe(current);
    }

    const cancels = evs.filter((e) => e.action === 'SALES_ORDER_CANCELLED');
    expect(cancels.length).toBeLessThanOrEqual(1);

    if (order.status === 'CANCELLED') {
      // Terminal: the cancellation is the last event, and nothing is written
      // for the order after it.
      expect(cancels).toHaveLength(1);
      expect(evs[evs.length - 1]).toBe(cancels[0]);
      const written = [
        ...fake.terms.filter((t) => t.salesOrderId === orderId),
        ...[...fake.receipts.values()].filter(
          (r) => r.salesOrderId === orderId,
        ),
        ...fake.approvals.filter((a) => a.salesOrderId === orderId),
      ];
      for (const row of written) {
        expect(row.seqNo ?? 0).toBeLessThan(cancels[0].seqNo);
      }
      return;
    }

    expect(cancels).toHaveLength(0);
    const verified = [...fake.receipts.values()].filter(
      (r) => r.salesOrderId === orderId && r.verificationStatus === 'VERIFIED',
    );
    const inForce = fake.approvals.filter(
      (a) => a.salesOrderId === orderId && a.status === 'APPROVED',
    );
    expect(verified.length).toBeLessThanOrEqual(1);
    expect(inForce.length).toBeLessThanOrEqual(1);
    if (evs.length > 0) {
      expect(verified.length).toBe(
        order.status === 'PENDING_STORE_APPROVAL' ? 0 : 1,
      );
      expect(inForce.length).toBe(
        order.status === 'READY_FOR_DISPATCH_ORDER' ? 1 : 0,
      );
    }
  };

  // -------------------------------------------------------------------------
  describe('transition tables for retract and cancel', () => {
    const all = [
      'OPEN',
      'PENDING_STORE_APPROVAL',
      'PENDING_ACCOUNTS_APPROVAL',
      'READY_FOR_DISPATCH_ORDER',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
      'CANCELLED',
      'SOMETHING_ELSE',
    ];

    it('a retraction is exactly one step back, most recent first', () => {
      expect(SALES_ORDER_RETRACTIONS).toEqual({
        PENDING_ACCOUNTS_APPROVAL: 'PENDING_STORE_APPROVAL',
        READY_FOR_DISPATCH_ORDER: 'PENDING_ACCOUNTS_APPROVAL',
      });
      const allowed = all.flatMap((f) =>
        all
          .filter((t) => isSalesOrderRetractionAllowed(f, t))
          .map((t) => `${f}>${t}`),
      );
      expect(allowed).toEqual([
        'PENDING_ACCOUNTS_APPROVAL>PENDING_STORE_APPROVAL',
        'READY_FOR_DISPATCH_ORDER>PENDING_ACCOUNTS_APPROVAL',
      ]);
    });

    it('cancel is allowed from exactly the three lifecycle statuses', () => {
      expect(SALES_ORDER_CANCELLABLE_STATUSES).toEqual([
        'PENDING_STORE_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL',
        'READY_FOR_DISPATCH_ORDER',
      ]);
      expect(all.filter((s) => isSalesOrderCancellationAllowed(s))).toEqual([
        'PENDING_STORE_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL',
        'READY_FOR_DISPATCH_ORDER',
      ]);
    });

    it('legacy OPEN and every OperationsOS status can be neither retracted nor cancelled', () => {
      for (const s of [
        'OPEN',
        'DISPATCH_ORDER_CREATED',
        'READY_FOR_INVOICING',
        'SOMETHING_ELSE',
      ]) {
        expect(isSalesOrderCancellationAllowed(s)).toBe(false);
        expect(SALES_ORDER_RETRACTIONS[s]).toBeUndefined();
        expect(() => assertSalesOrderCancellation(s)).toThrow();
      }
    });

    it('CANCELLED is terminal: nothing leaves it, and only cancel leads into it', () => {
      for (const t of all) {
        expect(isSalesOrderTransitionAllowed('CANCELLED', t)).toBe(false);
        expect(isSalesOrderRetractionAllowed('CANCELLED', t)).toBe(false);
        // No forward step or retraction leads into CANCELLED.
        expect(isSalesOrderTransitionAllowed(t, 'CANCELLED')).toBe(false);
        expect(isSalesOrderRetractionAllowed(t, 'CANCELLED')).toBe(false);
      }
      expect(isSalesOrderCancellationAllowed('CANCELLED')).toBe(false);
      expect(() => assertSalesOrderCancellation('CANCELLED')).toThrow();
      expect(() =>
        assertSalesOrderTransition('CANCELLED', 'PENDING_STORE_APPROVAL'),
      ).toThrow();
      expect(() =>
        assertSalesOrderRetraction('CANCELLED', 'PENDING_STORE_APPROVAL'),
      ).toThrow();
      expect(canRecordSalesOrderDocuments('CANCELLED')).toBe(false);
    });

    it('the forward transitions are exactly what they were', () => {
      expect(SALES_ORDER_TRANSITIONS).toEqual({
        PENDING_STORE_APPROVAL: ['PENDING_ACCOUNTS_APPROVAL'],
        PENDING_ACCOUNTS_APPROVAL: ['READY_FOR_DISPATCH_ORDER'],
      });
    });

    it('payment terms and receipts can be recorded in exactly two statuses', () => {
      expect(all.filter((s) => canRecordSalesOrderDocuments(s))).toEqual([
        'PENDING_STORE_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL',
      ]);
    });

    it('a retraction or cancellation helper refuses a move that is not in its table', () => {
      expect(() =>
        assertSalesOrderRetraction(
          'PENDING_STORE_APPROVAL',
          'PENDING_STORE_APPROVAL',
        ),
      ).toThrow();
      expect(() =>
        assertSalesOrderRetraction(
          'READY_FOR_DISPATCH_ORDER',
          'PENDING_STORE_APPROVAL',
        ),
      ).toThrow(); // skipping a step back
      expect(() =>
        assertSalesOrderRetraction(
          'PENDING_STORE_APPROVAL',
          'PENDING_ACCOUNTS_APPROVAL',
        ),
      ).toThrow(); // a retraction never moves forward
    });
  });

  // -------------------------------------------------------------------------
  describe('retract and cancel: request validation', () => {
    const targets: Array<
      [string, (b: unknown) => request.Test, () => Promise<void>]
    > = [
      [
        'retract verification',
        (b) => retractVerification(RECEIPT, b),
        async () => void (await orderAt('PENDING_ACCOUNTS_APPROVAL')),
      ],
      [
        'retract approval',
        (b) => retractApproval(fake.approvals[0]?.id ?? 'x', b),
        async () => void (await orderAt('READY_FOR_DISPATCH_ORDER')),
      ],
      [
        'cancel',
        (b) => cancel(ORDER, b),
        async () => void (await orderAt('PENDING_STORE_APPROVAL')),
      ],
    ];

    it.each(targets)(
      '%s: a missing, empty, blank, over-long or mistyped reason -> 400 and nothing changes',
      async (_n, call, setup) => {
        await setup();
        const before = snap();
        for (const body of [
          {},
          { reason: '' },
          { reason: '   ' },
          { reason: 7 },
          { reason: null },
          { reason: 'x'.repeat(501) },
        ]) {
          const res = await call(body);
          expect(res.status).toBe(400);
        }
        expect(snap()).toBe(before);
      },
    );

    it.each(targets)(
      '%s: a request that tries to name the actor or the outcome -> 400 and nothing changes',
      async (_n, call, setup) => {
        await setup();
        const before = snap();
        for (const extra of [
          { actorId: USER_2 },
          { verifiedBy: 'Someone Else' },
          { approvedBy: 'Someone Else' },
          { cancelledBy: USER_2 },
          { status: 'CANCELLED' },
        ]) {
          const res = await call({ ...REASON, ...extra });
          expect(res.status).toBe(400);
        }
        expect(snap()).toBe(before);
      },
    );
  });

  // -------------------------------------------------------------------------
  describe('retracting a verification', () => {
    it('PENDING_ACCOUNTS_APPROVAL -> PENDING_STORE_APPROVAL: the receipt is pending again, the verifier is cleared, the original event stays, and the retraction is attributed', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const original = { ...eventsOf(ORDER)[0] };
      expect(fake.receipts.get(RECEIPT).verifiedBy).toBe('Asha Accounts');

      user = { id: USER_2, permissions: ALL };
      const res = await retractVerification(RECEIPT, {
        reason: '  Wrong bank statement line  ',
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Verification retracted/);
      expect(res.body.salesOrder).toEqual({
        id: ORDER,
        status: 'PENDING_STORE_APPROVAL',
      });
      expect(res.body.receipt).toMatchObject({
        id: RECEIPT,
        verificationStatus: 'PENDING',
        verifiedBy: null,
        verifiedAt: null,
      });
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
      expect(fake.receipts.get(RECEIPT)).toMatchObject({
        verificationStatus: 'PENDING',
        verifiedBy: null,
        verifiedAt: null,
      });

      const events = eventsOf(ORDER);
      expect(events).toHaveLength(2);
      // The original verification event is untouched (append-only).
      expect(events[0]).toEqual(original);
      expect(events[1]).toMatchObject({
        salesOrderId: ORDER,
        action: 'ADVANCE_RECEIPT_VERIFICATION_RETRACTED',
        result: 'RETRACTED',
        fromStatus: 'PENDING_ACCOUNTS_APPROVAL',
        toStatus: 'PENDING_STORE_APPROVAL',
        referenceId: RECEIPT,
        remarks: 'Wrong bank statement line',
        actorId: USER_2,
      });
      expect(events[1].occurredAt).toBeInstanceOf(Date);
      expectConsistent(ORDER);
    });

    it('the receipt can be decided again afterwards: verify, or reject, or retract and verify again', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      expect((await retractVerification(RECEIPT, REASON)).status).toBe(200);
      const again = await verify(RECEIPT, { verificationStatus: 'VERIFIED' });
      expect(again.status).toBe(200);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      expect(eventsOf(ORDER).map((e) => e.action)).toEqual([
        'ADVANCE_RECEIPT_VERIFIED',
        'ADVANCE_RECEIPT_VERIFICATION_RETRACTED',
        'ADVANCE_RECEIPT_VERIFIED',
      ]);
      // A second retraction needs the second verification's event; it has one.
      expect((await retractVerification(RECEIPT, REASON)).status).toBe(200);
      expectConsistent(ORDER);
    });

    it('records the retraction under the signed-in user, never one named in the request', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      user = { id: USER_2, permissions: ALL };
      await retractVerification(RECEIPT, REASON);
      expect(eventsOf(ORDER)[1].actorId).toBe(USER_2);
      const history = await http().get(`/sales-orders/${ORDER}/events`);
      expect(history.status).toBe(200);
      expect(history.body[0]).toMatchObject({
        action: 'ADVANCE_RECEIPT_VERIFICATION_RETRACTED',
        actor: { id: USER_2, fullName: 'Ravi Reviewer' },
      });
      expect(history.body[1]).toMatchObject({
        action: 'ADVANCE_RECEIPT_VERIFIED',
        actor: { id: USER_1, fullName: 'Asha Accounts' },
      });
    });

    it('a pending receipt has no verification to retract (409)', async () => {
      seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
      seedReceipt(RECEIPT, ORDER, 'PENDING');
      const before = snap();
      const res = await retractVerification(RECEIPT, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not verified \(pending\)/);
      expect(snap()).toBe(before);
    });

    it('a rejected receipt stays terminal: it cannot be retracted (409)', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER);
      expect(
        (await verify(RECEIPT, { verificationStatus: 'REJECTED' })).status,
      ).toBe(200);
      const before = snap();
      const res = await retractVerification(RECEIPT, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not verified \(rejected\)/);
      expect(snap()).toBe(before);
    });

    it('while an approval is in force (READY_FOR_DISPATCH_ORDER) it is refused: retract the approval first (409, receipt stays VERIFIED)', async () => {
      await orderAt('READY_FOR_DISPATCH_ORDER');
      const before = snap();
      const res = await retractVerification(RECEIPT, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(
        /can only be retracted while the Sales Order is Pending Accounts Approval \(now Ready For Dispatch Order\)/,
      );
      expect(snap()).toBe(before);
      expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('VERIFIED');
    });

    it('an order that is still waiting for store approval has nothing to retract (409)', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      seedReceipt(RECEIPT, ORDER, 'VERIFIED'); // a stray verified receipt
      const before = snap();
      const res = await retractVerification(RECEIPT, REASON);
      expect(res.status).toBe(409);
      expect(snap()).toBe(before);
    });

    it.each([
      'OPEN',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
      'CANCELLED',
      'SOMETHING_ELSE',
    ])(
      'an order in %s cannot have a verification retracted (409, nothing changes)',
      async (status) => {
        seedOrder(ORDER, status);
        seedReceipt(RECEIPT, ORDER, 'VERIFIED');
        const before = snap();
        const res = await retractVerification(RECEIPT, REASON);
        expect(res.status).toBe(409);
        expect(snap()).toBe(before);
      },
    );

    it('a verification the workflow did not record (no event) can never be retracted: legacy data stays out of reach (409)', async () => {
      seedOrder(ORDER, 'PENDING_ACCOUNTS_APPROVAL');
      seedReceipt(RECEIPT, ORDER, 'VERIFIED');
      fake.receipts.get(RECEIPT).verifiedBy = 'Accounts Manager';
      const before = snap();
      const res = await retractVerification(RECEIPT, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(
        /not recorded by the Sales Order workflow/,
      );
      expect(snap()).toBe(before);
      expect(fake.receipts.get(RECEIPT).verifiedBy).toBe('Accounts Manager');
    });

    it('only the receipt the order advanced on can be retracted, not another verified receipt (409)', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      seedReceipt(RECEIPT_B, ORDER, 'VERIFIED'); // verified by hand, no event
      const before = snap();
      const res = await retractVerification(RECEIPT_B, REASON);
      expect(res.status).toBe(409);
      expect(snap()).toBe(before);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
    });

    it.each([
      ['a Dispatch Order', 'dispatchOrders'],
      ['a Dispatch', 'dispatches'],
      ['a Sales Invoice', 'invoices'],
    ] as const)(
      'is refused once the order has %s (409, nothing changes)',
      async (label, kind) => {
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        await fake.insertDownstream(kind, ORDER);
        const before = snap();
        const res = await retractVerification(RECEIPT, REASON);
        expect(res.status).toBe(409);
        expect(res.body.message).toContain(label);
        expect(res.body.message).toMatch(
          /Operations or Finance has taken it from here/,
        );
        expect(snap()).toBe(before);
        expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('VERIFIED');
      },
    );

    it('an unknown receipt -> 404', async () => {
      const res = await retractVerification(uid(999), REASON);
      expect(res.status).toBe(404);
    });

    it('retracting twice: the second is a 409 and records nothing', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      expect((await retractVerification(RECEIPT, REASON)).status).toBe(200);
      const before = snap();
      expect((await retractVerification(RECEIPT, REASON)).status).toBe(409);
      expect(snap()).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('retracting an accounts approval', () => {
    it('READY_FOR_DISPATCH_ORDER -> PENDING_ACCOUNTS_APPROVAL: the approval is kept and marked RETRACTED, the receipt stays VERIFIED, and the retraction is attributed', async () => {
      const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
      const original = { ...eventsOf(ORDER)[1] };
      user = { id: USER_2, permissions: ALL };
      const res = await retractApproval(approvalId!, {
        reason: '  Approved against the wrong order  ',
      });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Accounts approval retracted/);
      expect(res.body.salesOrder).toEqual({
        id: ORDER,
        status: 'PENDING_ACCOUNTS_APPROVAL',
      });
      expect(res.body.approval).toMatchObject({
        id: approvalId,
        status: 'RETRACTED',
      });
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      // Nothing is deleted: the row is still there, marked RETRACTED.
      expect(fake.approvals).toHaveLength(1);
      expect(fake.approvals[0].status).toBe('RETRACTED');
      expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('VERIFIED');

      const events = eventsOf(ORDER);
      expect(events).toHaveLength(3);
      expect(events[1]).toEqual(original);
      expect(events[2]).toMatchObject({
        action: 'ACCOUNTS_APPROVAL_RETRACTED',
        result: 'RETRACTED',
        fromStatus: 'READY_FOR_DISPATCH_ORDER',
        toStatus: 'PENDING_ACCOUNTS_APPROVAL',
        referenceId: approvalId,
        remarks: 'Approved against the wrong order',
        actorId: USER_2,
      });
      expectConsistent(ORDER);
    });

    it('a later approval is a new row: the table keeps RETRACTED then APPROVED', async () => {
      const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
      expect((await retractApproval(approvalId!, REASON)).status).toBe(200);
      const again = await approve({ salesOrderId: ORDER });
      expect(again.status).toBe(201);
      expect(fake.approvals.map((a) => a.status)).toEqual([
        'RETRACTED',
        'APPROVED',
      ]);
      expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
      // The new approval can be retracted too; the old one cannot be again.
      expect((await retractApproval(approvalId!, REASON)).status).toBe(409);
      expect((await retractApproval(fake.approvals[1].id, REASON)).status).toBe(
        200,
      );
      expectConsistent(ORDER);
    });

    it('the two retractions unwind the whole path, most recent first, back to PENDING_STORE_APPROVAL', async () => {
      const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
      expect((await retractApproval(approvalId!, REASON)).status).toBe(200);
      expect((await retractVerification(RECEIPT, REASON)).status).toBe(200);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
      expect(
        eventsOf(ORDER).map((e) => `${e.fromStatus}>${e.toStatus}`),
      ).toEqual([
        'PENDING_STORE_APPROVAL>PENDING_ACCOUNTS_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL>READY_FOR_DISPATCH_ORDER',
        'READY_FOR_DISPATCH_ORDER>PENDING_ACCOUNTS_APPROVAL',
        'PENDING_ACCOUNTS_APPROVAL>PENDING_STORE_APPROVAL',
      ]);
      expectConsistent(ORDER);
    });

    it('an approval already retracted is not in force (409)', async () => {
      const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
      await retractApproval(approvalId!, REASON);
      const before = snap();
      const res = await retractApproval(approvalId!, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not in force any more \(retracted\)/);
      expect(snap()).toBe(before);
    });

    it.each([
      'PENDING_STORE_APPROVAL',
      'PENDING_ACCOUNTS_APPROVAL',
      'OPEN',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
      'CANCELLED',
    ])(
      'an approval on an order in %s cannot be retracted (409, nothing changes)',
      async (status) => {
        seedOrder(ORDER, status);
        seedApproval(uid(51), ORDER);
        const before = snap();
        const res = await retractApproval(uid(51), REASON);
        expect(res.status).toBe(409);
        expect(snap()).toBe(before);
        expect(fake.approvals[0].status).toBe('APPROVED');
      },
    );

    it('an approval the workflow did not record (no event) can never be retracted: legacy approvals stay out of reach (409)', async () => {
      seedOrder(ORDER, 'READY_FOR_DISPATCH_ORDER');
      seedApproval(uid(51), ORDER);
      const before = snap();
      const res = await retractApproval(uid(51), REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(
        /not recorded by the Sales Order workflow/,
      );
      expect(snap()).toBe(before);
    });

    it.each([
      ['a Dispatch Order', 'dispatchOrders'],
      ['a Dispatch', 'dispatches'],
      ['a Sales Invoice', 'invoices'],
    ] as const)(
      'is refused once the order has %s (409, the approval stays in force)',
      async (label, kind) => {
        const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
        await fake.insertDownstream(kind, ORDER);
        const before = snap();
        const res = await retractApproval(approvalId!, REASON);
        expect(res.status).toBe(409);
        expect(res.body.message).toContain(label);
        expect(snap()).toBe(before);
        expect(fake.approvals[0].status).toBe('APPROVED');
        expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
      },
    );

    it('an unknown approval -> 404', async () => {
      expect((await retractApproval(uid(999), REASON)).status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('cancelling a Sales Order', () => {
    it.each([
      'PENDING_STORE_APPROVAL',
      'PENDING_ACCOUNTS_APPROVAL',
      'READY_FOR_DISPATCH_ORDER',
    ] as const)(
      'from %s -> CANCELLED, with one attributed event carrying the reason',
      async (stage) => {
        await orderAt(stage);
        const eventsBefore = eventsOf(ORDER).length;
        user = { id: USER_2, permissions: ALL };
        const res = await cancel(ORDER, {
          reason: '  Customer cancelled the PO  ',
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/Sales Order cancelled/);
        expect(res.body.salesOrder).toEqual({ id: ORDER, status: 'CANCELLED' });
        expect(fake.orders.get(ORDER).status).toBe('CANCELLED');

        const events = eventsOf(ORDER);
        expect(events).toHaveLength(eventsBefore + 1);
        const last = events[events.length - 1];
        expect(last).toMatchObject({
          salesOrderId: ORDER,
          action: 'SALES_ORDER_CANCELLED',
          result: 'CANCELLED',
          fromStatus: stage,
          toStatus: 'CANCELLED',
          remarks: 'Customer cancelled the PO',
          actorId: USER_2,
        });
        expect(last.referenceId).toBeUndefined();
        expectConsistent(ORDER);
      },
    );

    it('a VERIFIED advance stays exactly as it was: not voided, rejected, refunded or re-attributed', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const receiptBefore = { ...fake.receipts.get(RECEIPT) };
      const res = await cancel(ORDER, REASON);
      expect(res.status).toBe(200);
      expect(fake.receipts.get(RECEIPT)).toEqual(receiptBefore);
      expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('VERIFIED');
      expect(fake.receipts.get(RECEIPT).verifiedBy).toBe('Asha Accounts');
      // The original verification event is still the first, unchanged event.
      expect(eventsOf(ORDER)[0].action).toBe('ADVANCE_RECEIPT_VERIFIED');
      expectConsistent(ORDER);
    });

    it('pending, rejected and verified receipts, the payment terms and the approval are all left untouched', async () => {
      await orderAt('READY_FOR_DISPATCH_ORDER');
      seedReceipt(RECEIPT_B, ORDER, 'PENDING');
      seedReceipt(uid(13), ORDER, 'REJECTED');
      fake.terms.push({
        id: uid(61),
        salesOrderId: ORDER,
        paymentType: 'CREDIT',
      });
      const receipts = JSON.stringify([...fake.receipts.values()]);
      const approvals = JSON.stringify(fake.approvals);
      const terms = JSON.stringify(fake.terms);
      const prs = JSON.stringify(fake.prs);

      expect((await cancel(ORDER, REASON)).status).toBe(200);

      expect(JSON.stringify([...fake.receipts.values()])).toBe(receipts);
      expect(JSON.stringify(fake.approvals)).toBe(approvals);
      expect(fake.approvals[0].status).toBe('APPROVED');
      expect(JSON.stringify(fake.terms)).toBe(terms);
      expect(JSON.stringify(fake.prs)).toBe(prs);
      expect(
        eventsOf(ORDER).filter((e) => e.action === 'SALES_ORDER_CANCELLED'),
      ).toHaveLength(1);
    });

    it.each([
      'OPEN',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
      'SOMETHING_ELSE',
    ])(
      'legacy or OperationsOS status %s cannot be cancelled (409, nothing changes)',
      async (status) => {
        seedOrder(ORDER, status);
        const before = snap();
        const res = await cancel(ORDER, REASON);
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/cannot be cancelled here/);
        expect(snap()).toBe(before);
        expect(fake.orders.get(ORDER).status).toBe(status);
      },
    );

    it('an unknown order -> 404', async () => {
      expect((await cancel(uid(999), REASON)).status).toBe(404);
    });

    it('CANCELLED is terminal: cancelling again is a 409 and records nothing', async () => {
      await orderAt('PENDING_STORE_APPROVAL');
      expect((await cancel(ORDER, REASON)).status).toBe(200);
      const before = snap();
      const res = await cancel(ORDER, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/already cancelled/);
      expect(snap()).toBe(before);
    });

    it.each([
      ['a Dispatch Order', 'dispatchOrders'],
      ['a Dispatch', 'dispatches'],
      ['a Sales Invoice', 'invoices'],
    ] as const)(
      'is refused once the order has %s (409, status unchanged)',
      async (label, kind) => {
        await orderAt('READY_FOR_DISPATCH_ORDER');
        await fake.insertDownstream(kind, ORDER);
        const before = snap();
        const res = await cancel(ORDER, REASON);
        expect(res.status).toBe(409);
        expect(res.body.message).toContain(label);
        expect(snap()).toBe(before);
        expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
      },
    );

    it('is refused when procurement has acted: an approved requisition, a purchase order, or reserved stock', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const before = snap();

      fake.prs.push({ id: uid(71), salesOrderId: ORDER, status: 'APPROVED' });
      let res = await cancel(ORDER, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(
        /approved Purchase Requisition or a Purchase Order/,
      );
      fake.prs.length = 0;

      fake.prs.push({ id: uid(72), salesOrderId: ORDER, status: 'PENDING' });
      fake.purchaseOrders.push({ id: uid(73), purchaseRequisitionId: uid(72) });
      res = await cancel(ORDER, REASON);
      expect(res.status).toBe(409);
      fake.prs.length = 0;
      fake.purchaseOrders.length = 0;

      fake.reservations.push({
        id: uid(74),
        salesOrderId: ORDER,
        status: 'RESERVED',
      });
      res = await cancel(ORDER, REASON);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/reserved stock/);
      fake.reservations.length = 0;

      expect(snap()).toBe(before);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
    });

    it('a requisition that is still PENDING or was REJECTED, and released stock, do not block, and are left alone', async () => {
      await orderAt('PENDING_STORE_APPROVAL');
      fake.prs.push(
        { id: uid(71), salesOrderId: ORDER, status: 'PENDING' },
        { id: uid(72), salesOrderId: ORDER, status: 'REJECTED' },
      );
      fake.reservations.push({
        id: uid(74),
        salesOrderId: ORDER,
        status: 'RELEASED',
      });
      const prs = JSON.stringify(fake.prs);
      const reservations = JSON.stringify(fake.reservations);
      expect((await cancel(ORDER, REASON)).status).toBe(200);
      expect(JSON.stringify(fake.prs)).toBe(prs);
      expect(JSON.stringify(fake.reservations)).toBe(reservations);
    });

    it('does not touch the Proforma, the Quotation or any other order', async () => {
      await orderAt('PENDING_STORE_APPROVAL');
      seedOrder(uid(2), 'PENDING_STORE_APPROVAL', {
        proformaInvoiceId: PROFORMA_DUP,
      });
      fake.orders.get(ORDER).proformaInvoiceId = PROFORMA;
      const proformas = JSON.stringify([...fake.proformas.values()]);
      const other = JSON.stringify(fake.orders.get(uid(2)));
      expect((await cancel(ORDER, REASON)).status).toBe(200);
      expect(JSON.stringify([...fake.proformas.values()])).toBe(proformas);
      expect(JSON.stringify(fake.orders.get(uid(2)))).toBe(other);
    });
  });

  // -------------------------------------------------------------------------
  describe('after cancellation nothing in the workflow works (CANCELLED is terminal)', () => {
    it('verify, reject, approve, retract, cancel and both create gates all refuse with 409, and nothing is written', async () => {
      const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
      seedReceipt(RECEIPT_B, ORDER, 'PENDING');
      expect((await cancel(ORDER, REASON)).status).toBe(200);
      const before = snap();

      const results = await Promise.all([
        verify(RECEIPT_B, { verificationStatus: 'VERIFIED' }),
        verify(RECEIPT_B, { verificationStatus: 'REJECTED' }),
        approve({ salesOrderId: ORDER }),
        retractVerification(RECEIPT, REASON),
        retractApproval(approvalId!, REASON),
        cancel(ORDER, REASON),
        http().post('/sales-order-payment-terms/create').send({
          salesOrderId: ORDER,
          paymentType: 'CREDIT',
          advanceAmount: 0,
          balanceAmount: 1,
        }),
        http().post('/sales-order-advance-receipt/create').send({
          salesOrderId: ORDER,
          receiptDate: '2026-10-06',
          amountReceived: 1,
          paymentMode: 'UPI',
        }),
      ]);

      expect(results.map((r) => r.status)).toEqual(Array(8).fill(409));
      expect(snap()).toBe(before);
      // The pending receipt is still pending: a cancelled order takes no decisions.
      expect(fake.receipts.get(RECEIPT_B).verificationStatus).toBe('PENDING');
      expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
      expectConsistent(ORDER);
    });

    it('the history still reads in order, ending with the cancellation', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      await cancel(ORDER, REASON);
      const res = await http().get(`/sales-orders/${ORDER}/events`);
      expect(res.status).toBe(200);
      expect(res.body.map((e: any) => e.action)).toEqual([
        'SALES_ORDER_CANCELLED',
        'ADVANCE_RECEIPT_VERIFIED',
      ]);
      expect(res.body[0]).toMatchObject({
        remarks: REASON.reason,
        actor: { id: USER_1, fullName: 'Asha Accounts' },
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('server-side create gates for payment terms and advance receipts', () => {
    const term = (salesOrderId: string) =>
      http().post('/sales-order-payment-terms/create').send({
        salesOrderId,
        paymentType: 'PARTIAL_ADVANCE',
        advanceAmount: 100,
        balanceAmount: 200,
      });
    const receipt = (salesOrderId: string) =>
      http().post('/sales-order-advance-receipt/create').send({
        salesOrderId,
        receiptDate: '2026-10-06',
        amountReceived: 100,
        paymentMode: 'UPI',
      });

    it.each(['PENDING_STORE_APPROVAL', 'PENDING_ACCOUNTS_APPROVAL'])(
      'both are accepted while the order is %s',
      async (status) => {
        seedOrder(ORDER, status);
        expect((await term(ORDER)).status).toBe(201);
        expect((await receipt(ORDER)).status).toBe(201);
        expect(fake.terms).toHaveLength(1);
        expect(fake.receipts.size).toBe(1);
      },
    );

    it.each([
      'READY_FOR_DISPATCH_ORDER',
      'OPEN',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
      'CANCELLED',
      'SOMETHING_ELSE',
    ])(
      'both are refused (409) while the order is %s, and nothing is written',
      async (status) => {
        seedOrder(ORDER, status);
        const t = await term(ORDER);
        const r = await receipt(ORDER);
        expect(t.status).toBe(409);
        expect(r.status).toBe(409);
        expect(t.body.message).toMatch(/payment terms/i);
        expect(r.body.message).toMatch(/advance receipts/i);
        expect(fake.terms).toHaveLength(0);
        expect(fake.receipts.size).toBe(0);
        expect(fake.events).toHaveLength(0);
      },
    );

    it('a cancelled order is named as cancelled in the refusal', async () => {
      seedOrder(ORDER, 'CANCELLED');
      expect((await term(ORDER)).body.message).toMatch(/has been cancelled/);
      expect((await receipt(ORDER)).body.message).toMatch(/has been cancelled/);
    });

    it('an unknown order is still a 404', async () => {
      expect((await term(uid(999))).status).toBe(404);
      expect((await receipt(uid(999))).status).toBe(404);
    });

    it('still writes no lifecycle events', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      await term(ORDER);
      await receipt(ORDER);
      expect(fake.events).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('a cancelled order frees its Proforma: one NON-cancelled order per Proforma', () => {
    it('create -> cancel -> create again gives a new order; the cancelled one stays in history', async () => {
      const first = await createOrder(validOrder);
      expect(first.status).toBe(201);
      const firstId = first.body.id as string;
      expect((await cancel(firstId, REASON)).status).toBe(200);

      const second = await createOrder(validOrder);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(firstId);
      expect(second.body.status).toBe('PENDING_STORE_APPROVAL');
      expect(second.body.totalAmount).toBe(275000); // the Proforma's total again

      expect(fake.orders.get(firstId).status).toBe('CANCELLED');
      expect(fake.orders.size).toBe(2);
      expect(eventsOf(firstId).map((e) => e.action)).toEqual([
        'SALES_ORDER_CANCELLED',
      ]);
    });

    it('while the replacement is live a third create is a 409; once it is cancelled too, a fourth works', async () => {
      const a = await createOrder(validOrder);
      await cancel(a.body.id, REASON);
      const b = await createOrder(validOrder);
      expect(b.status).toBe(201);
      const refused = await createOrder(validOrder);
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe(
        'A Sales Order already exists for this Proforma Invoice.',
      );
      await cancel(b.body.id, REASON);
      expect((await createOrder(validOrder)).status).toBe(201);
      const statuses = [...fake.orders.values()].map((o) => o.status).sort();
      expect(statuses).toEqual([
        'CANCELLED',
        'CANCELLED',
        'PENDING_STORE_APPROVAL',
      ]);
    });

    it('a legacy OPEN order on the Proforma still blocks, and a cancelled one next to it does not change that', async () => {
      seedOrder(uid(2), 'OPEN', { proformaInvoiceId: PROFORMA });
      seedOrder(uid(3), 'CANCELLED', { proformaInvoiceId: PROFORMA });
      const res = await createOrder(validOrder);
      expect(res.status).toBe(409);
      expect(fake.orders.size).toBe(2);
    });

    it('does not change the Proforma or its approval status', async () => {
      const before = JSON.stringify([...fake.proformas.values()]);
      const a = await createOrder(validOrder);
      await cancel(a.body.id, REASON);
      await createOrder(validOrder);
      expect(JSON.stringify([...fake.proformas.values()])).toBe(before);
    });

    it('simultaneous creates after a cancellation still yield exactly one live order', async () => {
      const a = await createOrder(validOrder);
      await cancel(a.body.id, REASON);
      const rs = await Promise.all(
        Array.from({ length: 10 }, () => createOrder(validOrder)),
      );
      expect(rs.map((r) => r.status).sort()).toEqual([
        201,
        ...Array(9).fill(409),
      ]);
      const live = [...fake.orders.values()].filter(
        (o) => o.status !== 'CANCELLED',
      );
      expect(live).toHaveLength(1);
    });

    it('a cancellation racing a create for the same Proforma never leaves two live orders', async () => {
      for (let round = 0; round < 15; round += 1) {
        resetData();
        const a = await createOrder(validOrder);
        const [c, n] = await Promise.all([
          cancel(a.body.id, REASON),
          createOrder(validOrder),
        ]);
        expect(c.status).toBe(200);
        expect([201, 409]).toContain(n.status);
        const live = [...fake.orders.values()].filter(
          (o) => o.status !== 'CANCELLED',
        );
        expect(live.length).toBeLessThanOrEqual(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Sales Order funnel and conversion reports leave cancelled orders out', () => {
    const service = (extra: Record<string, number> = {}) => {
      const db = fake.root();
      return new SalesReportsService({
        ...db,
        lead: { count: async () => extra.leads ?? 10 },
        opportunity: { count: async () => extra.opportunities ?? 6 },
        quotation: { count: async () => extra.quotations ?? 4 },
        salesInvoice: { count: async () => extra.invoices ?? 1 },
      });
    };

    it('funnel() counts live orders as salesOrders and reports cancelled ones separately', async () => {
      seedOrder(uid(1), 'PENDING_STORE_APPROVAL');
      seedOrder(uid(2), 'READY_FOR_DISPATCH_ORDER');
      seedOrder(uid(3), 'OPEN');
      seedOrder(uid(4), 'READY_FOR_INVOICING');
      seedOrder(uid(5), 'CANCELLED');
      seedOrder(uid(6), 'CANCELLED');
      const res = await service().funnel();
      expect(res).toMatchObject({
        leads: 10,
        opportunities: 6,
        quotations: 4,
        salesOrders: 4,
        cancelledSalesOrders: 2,
        invoices: 1,
      });
    });

    it('quotationConversion() does not count a cancelled order as a conversion', async () => {
      seedOrder(uid(1), 'PENDING_STORE_APPROVAL');
      seedOrder(uid(2), 'CANCELLED');
      seedOrder(uid(3), 'CANCELLED');
      seedOrder(uid(4), 'CANCELLED');
      const res = await service({ quotations: 4 }).quotationConversion();
      expect(res).toMatchObject({
        totalQuotations: 4,
        convertedToSalesOrders: 1,
        cancelledSalesOrders: 3,
        conversionRate: '25.00%',
      });
    });

    it('with no cancelled orders the figures are what they were', async () => {
      seedOrder(uid(1), 'OPEN');
      seedOrder(uid(2), 'PENDING_STORE_APPROVAL');
      const f = await service().funnel();
      expect(f.salesOrders).toBe(2);
      expect(f.cancelledSalesOrders).toBe(0);
      const q = await service({ quotations: 4 }).quotationConversion();
      expect(q.conversionRate).toBe('50.00%');
    });
  });

  // -------------------------------------------------------------------------
  describe('atomicity: a failure part-way leaves nothing behind', () => {
    it('cancel: if the event cannot be written the order is not cancelled', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const before = snap();
      fake.failEvents = true;
      const res = await cancel(ORDER, REASON);
      expect(res.status).toBe(500);
      fake.failEvents = false;
      expect(snap()).toBe(before);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
    });

    it('retract verification: if the event cannot be written, the receipt is still VERIFIED, the verifier is intact and the order has not moved', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const before = snap();
      fake.failEvents = true;
      const res = await retractVerification(RECEIPT, REASON);
      expect(res.status).toBe(500);
      fake.failEvents = false;
      expect(snap()).toBe(before);
      expect(fake.receipts.get(RECEIPT)).toMatchObject({
        verificationStatus: 'VERIFIED',
        verifiedBy: 'Asha Accounts',
      });
      expect(fake.receipts.get(RECEIPT).verifiedAt).toBeInstanceOf(Date);
    });

    it('retract approval: if the event cannot be written, the approval is still in force and the order has not moved', async () => {
      const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
      const before = snap();
      fake.failEvents = true;
      const res = await retractApproval(approvalId!, REASON);
      expect(res.status).toBe(500);
      fake.failEvents = false;
      expect(snap()).toBe(before);
      expect(fake.approvals[0].status).toBe('APPROVED');
    });

    it('a refused retraction rolls back the receipt change it had already made (it is decided in the same transaction)', async () => {
      await orderAt('READY_FOR_DISPATCH_ORDER');
      const before = snap();
      expect((await retractVerification(RECEIPT, REASON)).status).toBe(409);
      expect(snap()).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('concurrency: retract and cancel', () => {
    const settle = <T>(calls: Array<Promise<T>>) => Promise.all(calls);
    const codes = (rs: Array<{ status: number }>) => rs.map((r) => r.status);
    const noServerErrors = (rs: Array<{ status: number }>) =>
      expect(codes(rs).filter((c) => c >= 500)).toEqual([]);

    it('double-submit: 10 simultaneous cancels -> exactly one succeeds, one event', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const rs = await settle(
        Array.from({ length: 10 }, () => cancel(ORDER, REASON)),
      );
      expect(codes(rs).sort()).toEqual([200, ...Array(9).fill(409)]);
      expect(
        eventsOf(ORDER).filter((e) => e.action === 'SALES_ORDER_CANCELLED'),
      ).toHaveLength(1);
      expectConsistent(ORDER);
    });

    it('double-submit: 10 simultaneous verification retractions -> exactly one succeeds, one event', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const rs = await settle(
        Array.from({ length: 10 }, () => retractVerification(RECEIPT, REASON)),
      );
      expect(codes(rs).sort()).toEqual([200, ...Array(9).fill(409)]);
      expect(
        eventsOf(ORDER).filter(
          (e) => e.action === 'ADVANCE_RECEIPT_VERIFICATION_RETRACTED',
        ),
      ).toHaveLength(1);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
      expectConsistent(ORDER);
    });

    it('double-submit: 10 simultaneous approval retractions -> exactly one succeeds, one event', async () => {
      const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
      const rs = await settle(
        Array.from({ length: 10 }, () => retractApproval(approvalId!, REASON)),
      );
      expect(codes(rs).sort()).toEqual([200, ...Array(9).fill(409)]);
      expect(
        eventsOf(ORDER).filter(
          (e) => e.action === 'ACCOUNTS_APPROVAL_RETRACTED',
        ),
      ).toHaveLength(1);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      expectConsistent(ORDER);
    });

    it('cancel vs verify of the same order: the order always ends CANCELLED; a verification wins only if it came first, and then it is on the record before the cancellation', async () => {
      for (let round = 0; round < 25; round += 1) {
        resetData();
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
        seedReceipt(RECEIPT, ORDER);
        const [c, v] = await settle([
          cancel(ORDER, REASON),
          verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
        ]);
        expect(c.status).toBe(200);
        expect([200, 409]).toContain(v.status);
        expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
        if (v.status === 409) {
          expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
        }
        expectConsistent(ORDER);
      }
    });

    it('cancel vs approve of the same order: always CANCELLED, never an approval written after the cancellation', async () => {
      for (let round = 0; round < 25; round += 1) {
        resetData();
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        const [c, a] = await settle([
          cancel(ORDER, REASON),
          approve({ salesOrderId: ORDER }),
        ]);
        expect(c.status).toBe(200);
        expect([201, 409]).toContain(a.status);
        expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
        expect(fake.approvals).toHaveLength(a.status === 201 ? 1 : 0);
        expectConsistent(ORDER);
      }
    });

    it('retract verification vs approve: exactly one wins and the order, receipt and approval agree', async () => {
      const seen = new Set<string>();
      for (let round = 0; round < 30; round += 1) {
        resetData();
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        const rs = await (round % 2
          ? settle([
              approve({ salesOrderId: ORDER }),
              retractVerification(RECEIPT, REASON),
            ])
          : settle([
              retractVerification(RECEIPT, REASON),
              approve({ salesOrderId: ORDER }),
            ]));
        const [approveRes, retractRes] = round % 2 ? rs : [rs[1], rs[0]];
        const outcome = `${approveRes.status}/${retractRes.status}`;
        seen.add(outcome);
        expect(['201/409', '409/200']).toContain(outcome);
        if (outcome === '201/409') {
          expect(fake.orders.get(ORDER).status).toBe(
            'READY_FOR_DISPATCH_ORDER',
          );
          expect(fake.receipts.get(RECEIPT).verificationStatus).toBe(
            'VERIFIED',
          );
        } else {
          expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
          expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
          expect(fake.approvals).toHaveLength(0);
        }
        expectConsistent(ORDER);
      }
      expect(seen.size).toBeGreaterThan(0);
    });

    it('retract approval vs retract verification at once: the order is only ever one step back', async () => {
      for (let round = 0; round < 20; round += 1) {
        resetData();
        const { approvalId } = await orderAt('READY_FOR_DISPATCH_ORDER');
        const rs = await settle([
          retractApproval(approvalId!, REASON),
          retractVerification(RECEIPT, REASON),
        ]);
        noServerErrors(rs);
        // The approval retraction is the only one that can succeed first; the
        // verification one succeeds only if it ran after.
        expect(rs[0].status).toBe(200);
        expect([200, 409]).toContain(rs[1].status);
        expect(fake.orders.get(ORDER).status).toBe(
          rs[1].status === 200
            ? 'PENDING_STORE_APPROVAL'
            : 'PENDING_ACCOUNTS_APPROVAL',
        );
        expectConsistent(ORDER);
      }
    });

    it('verifying one receipt while another is retracted does not deadlock (locks are taken receipt first, then order)', async () => {
      for (let round = 0; round < 20; round += 1) {
        resetData();
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        seedReceipt(RECEIPT_B, ORDER, 'PENDING');
        const rs = await settle([
          retractVerification(RECEIPT, REASON),
          verify(RECEIPT_B, { verificationStatus: 'VERIFIED' }),
          verify(RECEIPT_B, { verificationStatus: 'REJECTED' }),
          approve({ salesOrderId: ORDER }),
          cancel(ORDER, REASON),
        ]);
        noServerErrors(rs);
        expectConsistent(ORDER);
      }
    });

    it('payment terms and receipts created while a cancellation runs: none is written after the cancellation', async () => {
      for (let round = 0; round < 15; round += 1) {
        resetData();
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
        const create = () => [
          http().post('/sales-order-payment-terms/create').send({
            salesOrderId: ORDER,
            paymentType: 'CREDIT',
            advanceAmount: 0,
            balanceAmount: 1,
          }),
          http().post('/sales-order-advance-receipt/create').send({
            salesOrderId: ORDER,
            receiptDate: '2026-10-06',
            amountReceived: 1,
            paymentMode: 'UPI',
          }),
        ];
        const rs = await settle([
          ...create(),
          ...create(),
          cancel(ORDER, REASON),
          ...create(),
          ...create(),
        ]);
        noServerErrors(rs);
        expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
        expectConsistent(ORDER); // checks no row is newer than the cancellation
      }
    });

    it('a mixed storm of every action on one order always leaves a consistent order (events chain, no post-cancel writes, no server errors)', async () => {
      const actions = (approvalGuess: string) => [
        () => verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
        () => verify(RECEIPT, { verificationStatus: 'REJECTED' }),
        () => verify(RECEIPT_B, { verificationStatus: 'VERIFIED' }),
        () => approve({ salesOrderId: ORDER }),
        () => retractVerification(RECEIPT, REASON),
        () => retractVerification(RECEIPT_B, REASON),
        () => retractApproval(approvalGuess, REASON),
        () => cancel(ORDER, REASON),
        () =>
          http().post('/sales-order-advance-receipt/create').send({
            salesOrderId: ORDER,
            receiptDate: '2026-10-06',
            amountReceived: 1,
            paymentMode: 'UPI',
          }),
      ];
      let rounds = 0;
      for (let round = 0; round < 60; round += 1) {
        resetData();
        const start = (
          [
            'PENDING_STORE_APPROVAL',
            'PENDING_ACCOUNTS_APPROVAL',
            'READY_FOR_DISPATCH_ORDER',
          ] as const
        )[round % 3];
        const { approvalId } = await orderAt(start);
        seedReceipt(RECEIPT_B, ORDER, 'PENDING');
        const pool = actions(approvalId ?? uid(998));
        const plan = Array.from(
          { length: 5 + (round % 6) },
          (_, k) => pool[(round * 7 + k * 3 + (round >> 1)) % pool.length],
        );
        const rs = await settle(plan.map((f) => f()));
        noServerErrors(rs);
        expectConsistent(ORDER);
        rounds += 1;
      }
      expect(rounds).toBe(60);
    });

    // Starts a verification retraction and holds it, with the order locked,
    // part-way through its checks; fires an approval at the same moment; then
    // lets the retraction finish.
    const retractWhileApproving = async () => {
      let release!: () => void;
      const gated = new Promise<void>((r) => {
        release = r;
      });
      fake.gates['dispatchOrder.count'] = () => gated;
      const retracting = retractVerification(RECEIPT, REASON).then((r) => r);
      await new Promise((r) => setTimeout(r, 20)); // it now holds the order lock
      const approving = approve({ salesOrderId: ORDER }).then((r) => r);
      await new Promise((r) => setTimeout(r, 20));
      release();
      return { retracting: await retracting, approving: await approving };
    };

    // Starts a receipt creation and holds it after it has checked the order's
    // status; cancels the order meanwhile; then lets the receipt through.
    const createWhileCancelling = async () => {
      let release!: () => void;
      const gated = new Promise<void>((r) => {
        release = r;
      });
      fake.gates['salesOrderAdvanceReceipt.create'] = () => gated;
      const creating = http()
        .post('/sales-order-advance-receipt/create')
        .send({
          salesOrderId: ORDER,
          receiptDate: '2026-10-06',
          amountReceived: 1,
          paymentMode: 'UPI',
        })
        .then((r) => r);
      await new Promise((r) => setTimeout(r, 20)); // it has read the status
      const cancelling = cancel(ORDER, REASON).then((r) => r);
      await new Promise((r) => setTimeout(r, 20));
      release();
      return { creating: await creating, cancelling: await cancelling };
    };

    it('an approval that arrives while a retraction has the order locked waits, then is refused (409): the order is never READY with a pending receipt', async () => {
      await orderAt('PENDING_ACCOUNTS_APPROVAL');
      const { retracting, approving } = await retractWhileApproving();
      expect(retracting.status).toBe(200);
      expect(approving.status).toBe(409);
      expect(fake.orders.get(ORDER).status).toBe('PENDING_STORE_APPROVAL');
      expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
      expect(fake.approvals).toHaveLength(0);
      expectConsistent(ORDER);
    });

    it('a receipt that has checked the order is not overtaken by a cancellation: the cancellation waits for it, so the receipt is on record before the cancellation', async () => {
      seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
      const { creating, cancelling } = await createWhileCancelling();
      expect(creating.status).toBe(201);
      expect(cancelling.status).toBe(200);
      expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
      expectConsistent(ORDER);
    });

    // -----------------------------------------------------------------------
    describe('an insert for the order that is already in flight (Operations or Finance) and a cancellation', () => {
      it('the cancellation waits for the in-flight insert, sees it, and refuses (409): the order is not cancelled over a live invoice', async () => {
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        const insert = fake.insertDownstream('invoices', ORDER, 40);
        await new Promise((r) => setTimeout(r, 5)); // the insert has taken its lock
        const res = await cancel(ORDER, REASON);
        await insert;
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/Sales Invoice/);
        expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      });

      it('an insert that starts while a cancellation is deciding waits for it and lands after it', async () => {
        await orderAt('PENDING_STORE_APPROVAL');
        let release!: () => void;
        const gated = new Promise<void>((r) => {
          release = r;
        });
        fake.gates['salesInvoice.count'] = () => gated; // pause the cancel after its checks
        const cancelling = cancel(ORDER, REASON).then((r) => r);
        await new Promise((r) => setTimeout(r, 15)); // the cancel holds the order lock
        let inserted = false;
        const insert = fake.insertDownstream('invoices', ORDER).then((row) => {
          inserted = true;
          return row;
        });
        await new Promise((r) => setTimeout(r, 15));
        expect(inserted).toBe(false); // blocked behind the cancellation
        release();
        const res = await cancelling;
        const row = await insert;
        expect(res.status).toBe(200);
        // The invoice was serialised after the cancellation. Refusing it is the
        // job of the Sales Invoice guard (a later checkpoint), not of this one.
        expect(row.orderStatusAtInsert).toBe('CANCELLED');
      });
    });

    // -----------------------------------------------------------------------
    describe('negative controls: with the protection removed, the same checks catch the race', () => {
      it('without the status condition, a verification slips in after a cancellation and the order comes back to life', async () => {
        fake.stripCas = true;
        let revived = 0;
        for (let round = 0; round < 25; round += 1) {
          resetData();
          fake.stripCas = true;
          seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
          seedReceipt(RECEIPT, ORDER);
          await settle([
            cancel(ORDER, REASON),
            verify(RECEIPT, { verificationStatus: 'VERIFIED' }),
          ]);
          if (fake.orders.get(ORDER).status !== 'CANCELLED') revived += 1;
        }
        expect(revived).toBeGreaterThan(0);
      });

      it('without the status condition AND the order lock, ten cancellations all "succeed" and write ten events', async () => {
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        fake.stripCas = true;
        fake.noOrderLock = true;
        const rs = await settle(
          Array.from({ length: 10 }, () => cancel(ORDER, REASON)),
        );
        expect(rs.filter((r) => r.status === 200).length).toBeGreaterThan(1);
        expect(
          eventsOf(ORDER).filter((e) => e.action === 'SALES_ORDER_CANCELLED')
            .length,
        ).toBeGreaterThan(1);
      });

      it('the protections back each other up: with only one of them removed, ten cancellations are still kept to one', async () => {
        for (const off of ['stripCas', 'noOrderLock'] as const) {
          resetData();
          await orderAt('PENDING_ACCOUNTS_APPROVAL');
          fake[off] = true;
          const rs = await settle(
            Array.from({ length: 10 }, () => cancel(ORDER, REASON)),
          );
          expect(codes(rs).sort()).toEqual([200, ...Array(9).fill(409)]);
        }
      });

      it('ten verification retractions stay at one even with the status condition and the order lock both removed: the receipt row itself is locked by the first update, and the status is then re-read', async () => {
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        fake.stripCas = true;
        fake.noOrderLock = true;
        const rs = await settle(
          Array.from({ length: 10 }, () =>
            retractVerification(RECEIPT, REASON),
          ),
        );
        expect(codes(rs).sort()).toEqual([200, ...Array(9).fill(409)]);
      });

      it('without the status condition, an approval that arrives while a retraction holds the order skips a step (READY with a pending receipt)', async () => {
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        fake.stripCas = true;
        const { retracting, approving } = await retractWhileApproving();
        expect(retracting.status).toBe(200);
        expect(approving.status).toBe(201); // it should have been refused
        expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
        expect(fake.receipts.get(RECEIPT).verificationStatus).toBe('PENDING');
      });

      it('without the shared lock on the order, a receipt that was checked before the cancellation is recorded after it', async () => {
        seedOrder(ORDER, 'PENDING_STORE_APPROVAL');
        fake.noSharedLock = true;
        const { creating, cancelling } = await createWhileCancelling();
        expect(creating.status).toBe(201);
        expect(cancelling.status).toBe(200);
        const cancelEvent = fake.events.find(
          (e) => e.action === 'SALES_ORDER_CANCELLED',
        );
        expect(
          [...fake.receipts.values()].some((r) => r.seqNo > cancelEvent.seqNo),
        ).toBe(true);
      });

      it('without the FOR UPDATE lock on the order, a cancellation goes ahead over an invoice that was already being written', async () => {
        await orderAt('PENDING_ACCOUNTS_APPROVAL');
        fake.noOrderLock = true;
        const insert = fake.insertDownstream('invoices', ORDER, 40);
        await new Promise((r) => setTimeout(r, 5));
        const res = await cancel(ORDER, REASON);
        await insert;
        expect(res.status).toBe(200); // the check ran before the invoice was visible
        expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
        expect(fake.invoices).toHaveLength(1); // a cancelled order with an invoice
      });
    });
  });
});
