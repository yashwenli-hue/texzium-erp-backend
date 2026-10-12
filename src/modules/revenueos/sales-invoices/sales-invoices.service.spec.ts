/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PrismaService } from '../../../core/database/prisma.service';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { SalesInvoicesController } from './sales-invoices.controller';
import {
  ALREADY_INVOICED_MESSAGE,
  SalesInvoicesService,
} from './sales-invoices.service';
import * as invoiceLock from './invoice-order-lock';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORDER = uid(1);
const OTHER_ORDER = uid(2);
const DISPATCH = uid(11); // a DISPATCHED Dispatch Order; not linked to the order
const USER = 'user-1';
const CANCELLED_MESSAGE = 'A cancelled Sales Order cannot be invoiced.';
// The chain every seeded order is built from: a Quotation of 1,00,000 + 18% IGST
// for the customer "Acme Industries", sold by the Gujarat registration.
const SELLER = 'seller-24';
const BUYER = 'buyer-acme';
const CUSTOMER = 'cust-acme';
const OPP = 'opp-acme';

// ---------------------------------------------------------------------------
// A stateful fake of the database invoice creation and cancellation use. It has
// real transaction rollback and PostgreSQL's row-lock rules (FOR KEY SHARE,
// FOR SHARE, FOR NO KEY UPDATE, FOR UPDATE with the real conflict matrix, held
// until the transaction ends; inserting a row that points at a Sales Order
// takes FOR KEY SHARE on it, as the foreign-key check does). `gates` hold a
// call before or after it runs so a test can force an exact interleaving.
// ---------------------------------------------------------------------------
type Mode = 'KEY_SHARE' | 'SHARE' | 'NO_KEY_UPDATE' | 'UPDATE';
const CONFLICTS: Record<Mode, Mode[]> = {
  KEY_SHARE: ['UPDATE'],
  SHARE: ['NO_KEY_UPDATE', 'UPDATE'],
  NO_KEY_UPDATE: ['SHARE', 'NO_KEY_UPDATE', 'UPDATE'],
  UPDATE: ['KEY_SHARE', 'SHARE', 'NO_KEY_UPDATE', 'UPDATE'],
};

class FakeDb {
  orders = new Map<string, any>();
  dispatchOrders = new Map<string, any>();
  invoices: any[] = [];
  receivables: any[] = [];
  ledger: any[] = [];
  journals: any[] = [];
  journalLines: any[] = [];
  events: any[] = [];
  accounts = new Map<string, any>();
  years: any[] = [];
  users = new Map<string, any>([
    [USER, { id: USER, fullName: 'Asha Accounts' }],
  ]);
  quotations = new Map<string, any>();
  proformas = new Map<string, any>();
  quotationLines: any[] = [];
  proformaLines: any[] = [];
  sellers = new Map<string, any>();
  buyers = new Map<string, any>();
  opportunities = new Map<string, any>();
  customers = new Map<string, any>();
  invoiceItems: any[] = [];
  counters = new Map<string, number>();
  clock = 0;
  seq = 100;
  failInvoiceInsert = false;
  gates: Record<string, () => Promise<void>> = {};
  private holders = new Map<string, Array<{ owner: symbol; mode: Mode }>>();
  private held = new Map<symbol, string[]>();

  nextId() {
    this.seq += 1;
    return uid(this.seq);
  }

  stamp<T extends object>(row: T): T & { seqNo: number } {
    this.clock += 1;
    return Object.assign(row, { seqNo: this.clock });
  }

  async lock(owner: symbol, key: string, mode: Mode) {
    for (let spin = 0; ; spin += 1) {
      const others = (this.holders.get(key) ?? []).filter(
        (h) => h.owner !== owner,
      );
      if (!others.some((h) => CONFLICTS[mode].includes(h.mode))) {
        const list = this.holders.get(key) ?? [];
        list.push({ owner, mode });
        this.holders.set(key, list);
        this.held.set(owner, [...(this.held.get(owner) ?? []), key]);
        return;
      }
      if (spin > 20000) throw new Error(`deadlock waiting for ${key}`);
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  release(owner: symbol) {
    for (const key of this.held.get(owner) ?? []) {
      const rest = (this.holders.get(key) ?? []).filter(
        (h) => h.owner !== owner,
      );
      if (rest.length) this.holders.set(key, rest);
      else this.holders.delete(key);
    }
    this.held.delete(owner);
  }

  private matches(row: any, where: any) {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object') {
        const c = v as any;
        if ('not' in c) return row[k] !== c.not;
        if ('notIn' in c) return !c.notIn.includes(row[k]);
        return false;
      }
      return row[k] === v;
    });
  }

  client(owner: symbol, journal: Array<() => void> | null): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const inTx = journal !== null;
    const undo = (fn: () => void) => journal?.push(fn);
    const gate = async (name: string) => {
      if (self.gates[name]) await self.gates[name]();
    };
    const insert = (rows: any[], data: any) => {
      const row = self.stamp({
        id: self.nextId(),
        createdAt: new Date(),
        ...data,
      });
      rows.push(row);
      undo(() => rows.splice(rows.indexOf(row), 1));
      return { ...row };
    };
    const none = () => ({ count: jest.fn(async () => 0) });

    const d: any = {
      user: {
        findUnique: jest.fn(async (a: any) => {
          const u = self.users.get(a.where.id);
          return u ? { id: u.id, fullName: u.fullName } : null;
        }),
      },
      salesOrder: {
        findUnique: jest.fn(async (a: any) => {
          const o = self.orders.get(a.where.id);
          if (!o) return null;
          return a.select
            ? Object.fromEntries(Object.keys(a.select).map((k) => [k, o[k]]))
            : { ...o };
        }),
        updateMany: jest.fn(async (a: any) => {
          let count = 0;
          for (const row of [...self.orders.values()].filter(
            (r) => r.id === a.where.id,
          )) {
            if (inTx)
              await self.lock(owner, `order:${row.id}`, 'NO_KEY_UPDATE');
            if (self.matches(row, a.where)) {
              const before = { ...row };
              Object.assign(row, a.data);
              undo(() => Object.assign(row, before));
              count += 1;
            }
          }
          return { count };
        }),
      },
      dispatchOrder: {
        findUnique: jest.fn(async (a: any) => {
          const x = self.dispatchOrders.get(a.where.id);
          return x ? { ...x } : null;
        }),
        count: jest.fn(async (a: any) => {
          const n = [...self.dispatchOrders.values()].filter((x) =>
            self.matches(x, a.where),
          ).length;
          await gate('dispatchOrder.count:after');
          return n;
        }),
      },
      salesInvoice: {
        count: jest.fn(
          async (a: any) =>
            self.invoices.filter((x) => self.matches(x, a.where)).length,
        ),
        findFirst: jest.fn(async (a: any) => {
          const prefix = a.where.invoiceNumber.startsWith;
          const rows = self.invoices
            .filter((x) => (x.invoiceNumber ?? '').startsWith(prefix))
            .sort((x, y) => y.invoiceDate.getTime() - x.invoiceDate.getTime());
          return rows[0]
            ? {
                invoiceNumber: rows[0].invoiceNumber,
                invoiceDate: rows[0].invoiceDate,
              }
            : null;
        }),
        create: jest.fn(async (a: any) => {
          await gate('salesInvoice.create:before');
          if (self.failInvoiceInsert) throw new Error('invoice insert failed');
          if (inTx)
            await self.lock(owner, `order:${a.data.salesOrderId}`, 'KEY_SHARE');
          return insert(self.invoices, a.data);
        }),
      },
      salesInvoiceItem: {
        createMany: jest.fn(async (a: any) => {
          for (const row of a.data) insert(self.invoiceItems, row);
          return { count: a.data.length };
        }),
      },
      quotation: {
        findUnique: jest.fn(async (a: any) => {
          const q = self.quotations.get(a.where.id);
          return q ? { ...q } : null;
        }),
      },
      proformaInvoice: {
        findUnique: jest.fn(async (a: any) => {
          const x = self.proformas.get(a.where.id);
          return x ? { ...x } : null;
        }),
      },
      quotationLine: {
        findMany: jest.fn(async (a: any) =>
          self.quotationLines
            .filter((l) => l.quotationId === a.where.quotationId)
            .map((l) => ({ ...l })),
        ),
      },
      proformaInvoiceLine: {
        findMany: jest.fn(async (a: any) =>
          self.proformaLines
            .filter((l) => l.proformaInvoiceId === a.where.proformaInvoiceId)
            .map((l) => ({ ...l })),
        ),
      },
      companyGSTRegistration: {
        findUnique: jest.fn(async (a: any) => {
          const x = self.sellers.get(a.where.id);
          return x ? { ...x } : null;
        }),
      },
      customerGSTRegistration: {
        findUnique: jest.fn(async (a: any) => {
          const x = self.buyers.get(a.where.id);
          return x ? { ...x } : null;
        }),
      },
      opportunity: {
        findUnique: jest.fn(async (a: any) => {
          const x = self.opportunities.get(a.where.id);
          return x ? { ...x } : null;
        }),
      },
      customer: {
        findUnique: jest.fn(async (a: any) => {
          const x = self.customers.get(a.where.id);
          return x ? { id: x.id, customerName: x.customerName } : null;
        }),
      },
      accountsReceivable: {
        create: jest.fn(async (a: any) => insert(self.receivables, a.data)),
      },
      customerLedger: {
        findFirst: jest.fn(async (a: any) => {
          const rows = self.ledger.filter((x) => self.matches(x, a.where));
          return rows.length ? { ...rows[rows.length - 1] } : null;
        }),
        create: jest.fn(async (a: any) => insert(self.ledger, a.data)),
      },
      chartOfAccount: {
        findFirst: jest.fn(async (a: any) => {
          const x = [...self.accounts.values()].find(
            (r) => r.accountCode === a.where.accountCode,
          );
          return x ? { ...x } : null;
        }),
      },
      financialYear: {
        findFirst: jest.fn(async () =>
          self.years[0] ? { ...self.years[0] } : null,
        ),
      },
      journalEntry: {
        create: jest.fn(async (a: any) => insert(self.journals, a.data)),
      },
      journalLine: {
        create: jest.fn(async (a: any) => insert(self.journalLines, a.data)),
      },
      dispatch: none(),
      purchaseRequisition: none(),
      purchaseOrder: none(),
      inventoryReservation: none(),
      salesOrderEvent: {
        create: jest.fn(async (a: any) => insert(self.events, a.data)),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
        const sql = strings.join('?').replace(/\s+/g, ' ');
        if (sql.includes('document-number:allocate')) {
          // the counter row is locked until the transaction ends, like the upsert
          const key = v.join('|');
          if (inTx) await self.lock(owner, `counter:${key}`, 'UPDATE');
          const before = self.counters.get(key) ?? 0;
          self.counters.set(key, before + 1);
          undo(() => self.counters.set(key, before));
          return [{ lastNumber: before + 1 }];
        }
        const id = v[0];
        if (!sql.includes('FROM "SalesOrder"'))
          throw new Error(`unexpected raw query: ${sql}`);
        const mode: Mode | null = sql.includes('FOR UPDATE')
          ? 'UPDATE'
          : sql.includes('FOR SHARE')
            ? 'SHARE'
            : null;
        if (mode && inTx) await self.lock(owner, `order:${id}`, mode);
        const o = self.orders.get(id);
        return o ? [{ status: o.status }] : [];
      }),
    };

    // Every call yields first (a database round trip), so overlapping
    // transactions really interleave; named gates can hold a call.
    for (const key of Object.keys(d)) {
      const target = d[key];
      const wrap =
        (name: string, fn: (...a: any[]) => Promise<any>) =>
        async (...args: any[]) => {
          await new Promise<void>((r) => setImmediate(r));
          await gate(`${name}:before`);
          const out = await fn(...args);
          await gate(`${name}:after`);
          return out;
        };
      if (typeof target === 'function') d[key] = wrap(key, target);
      else
        for (const m of Object.keys(target))
          target[m] = wrap(`${key}.${m}`, target[m]);
    }
    return d;
  }

  root(): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      ...self.client(Symbol('root'), null),
      $transaction: jest.fn(async (fn: any) => {
        const journal: Array<() => void> = [];
        const owner = Symbol('tx');
        try {
          const out = await fn(self.client(owner, journal));
          self.release(owner);
          return out;
        } catch (err) {
          for (const u of journal.reverse()) u();
          self.release(owner);
          throw err;
        }
      }),
    };
  }
}

describe('Sales Invoice creation and cancelled Sales Orders', () => {
  let app: INestApplication;
  let fake: FakeDb;
  let service: SalesInvoicesService;
  let cancelService: SalesOrdersService;

  beforeAll(async () => {
    fake = new FakeDb();
    const moduleRef = await Test.createTestingModule({
      controllers: [SalesInvoicesController],
      providers: [
        SalesInvoicesService,
        { provide: PrismaService, useFactory: () => fake.root() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
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
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fake.orders.clear();
    fake.dispatchOrders.clear();
    fake.quotations.clear();
    fake.proformas.clear();
    fake.counters.clear();
    for (const rows of [
      fake.quotationLines,
      fake.proformaLines,
      fake.invoiceItems,
      fake.invoices,
      fake.receivables,
      fake.ledger,
      fake.journals,
      fake.journalLines,
      fake.events,
      fake.years,
    ]) {
      rows.length = 0;
    }
    fake.accounts.clear();
    fake.gates = {};
    fake.clock = 0;
    fake.failInvoiceInsert = false;
    for (const [i, code] of ['1101', '3001', '5002'].entries()) {
      fake.accounts.set(code, { id: uid(300 + i), accountCode: code });
    }
    fake.years.push({ id: uid(400), isClosed: false });
    fake.sellers.set(SELLER, { id: SELLER, stateCode: '24', isActive: true });
    fake.buyers.set(BUYER, { id: BUYER, customerId: CUSTOMER });
    fake.opportunities.set(OPP, { customerId: CUSTOMER });
    fake.customers.set(CUSTOMER, {
      id: CUSTOMER,
      customerName: 'Acme Industries',
    });
    fake.dispatchOrders.set(DISPATCH, {
      id: DISPATCH,
      status: 'DISPATCHED',
      salesOrderId: null,
    });
    // The services are plain classes over the same fake the app uses.
    const prisma = app.get(PrismaService) ?? fake.root();
    service = new SalesInvoicesService(prisma);
    cancelService = new SalesOrdersService(prisma);
    jest.restoreAllMocks();
  });

  // An order built from its own Quotation (1,00,000 taxable + 18% GST =
  // 1,18,000) with one priced line; `quotation` overrides the Quotation.
  const seedOrder = (
    status: string,
    extra: any = {},
    id = ORDER,
    quotation: any = {},
  ) => {
    const qid = `q-${id}`;
    fake.quotations.set(qid, {
      id: qid,
      taxableAmount: 100000,
      gstPercent: 18,
      gstAmount: 18000,
      totalAmount: 118000,
      taxType: 'IGST',
      sellerGstId: SELLER,
      buyerGstId: BUYER,
      opportunityId: OPP,
      ...quotation,
    });
    const stale = fake.quotationLines.findIndex((l) => l.quotationId === qid);
    if (stale >= 0) fake.quotationLines.splice(stale, 1);
    fake.quotationLines.push({
      id: `ql-${id}`,
      quotationId: qid,
      lineNumber: 1,
      inventoryItemId: 'item-pump',
      description: 'Industrial pump',
      hsnCode: '84137090',
      quantity: 4,
      unitRate: 25000,
      taxableAmount: 100000,
      gstRate: 18,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 18000,
      gstAmount: 18000,
      totalAmount: 118000,
    });
    fake.orders.set(id, {
      id,
      status,
      totalAmount: 118000,
      taxType: 'IGST',
      quotationId: qid,
      proformaInvoiceId: null,
      sellerGstId: SELLER,
      buyerGstId: BUYER,
      ...extra,
    });
  };
  const body = (extra: any = {}) => ({
    salesOrderId: ORDER,
    dispatchOrderId: DISPATCH,
    invoiceDate: '2026-10-07',
    customerName: 'Acme Industries',
    ...extra,
  });
  const post = (b: unknown) =>
    request(app.getHttpServer())
      .post('/sales-invoices')
      .send(b as object);
  const writes = () =>
    JSON.stringify({
      i: fake.invoices,
      r: fake.receivables,
      l: fake.ledger,
      j: fake.journals,
      jl: fake.journalLines,
    });
  const snap = () =>
    JSON.stringify({
      o: [...fake.orders.values()],
      d: [...fake.dispatchOrders.values()],
      w: writes(),
      e: fake.events,
    });
  const errorOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as Error).message;
    }
    return null;
  };

  // =========================================================================
  describe('a CANCELLED Sales Order is refused', () => {
    beforeEach(() => seedOrder('CANCELLED'));

    it('-> 409 (a business-state refusal, not a 500) with a clear message', async () => {
      const res = await post(body());
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(CANCELLED_MESSAGE);
      expect(res.body.error).toBe('Conflict');
    });

    it('writes nothing at all: no invoice, receivable, ledger entry or journal, and the order and Dispatch Order are untouched', async () => {
      const before = snap();
      const res = await post(body());
      expect(res.status).toBe(409);
      expect(fake.invoices).toHaveLength(0);
      expect(fake.receivables).toHaveLength(0);
      expect(fake.ledger).toHaveLength(0);
      expect(fake.journals).toHaveLength(0);
      expect(fake.journalLines).toHaveLength(0);
      expect(snap()).toBe(before);
      expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
    });

    it('is refused however often it is retried', async () => {
      const before = snap();
      for (let i = 0; i < 5; i += 1)
        expect((await post(body())).status).toBe(409);
      expect(snap()).toBe(before);
    });

    it('only the order named in the request matters: another, live order can still be invoiced', async () => {
      seedOrder('READY_FOR_INVOICING', {}, OTHER_ORDER);
      expect((await post(body({ salesOrderId: OTHER_ORDER }))).status).toBe(
        201,
      );
      expect(fake.invoices).toHaveLength(1);
      expect(fake.invoices[0].salesOrderId).toBe(OTHER_ORDER);
      expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
    });
  });

  // =========================================================================
  describe('every other Sales Order status behaves exactly as before', () => {
    it.each([
      'READY_FOR_DISPATCH_ORDER',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
      'OPEN',
      'PENDING_STORE_APPROVAL',
      'PENDING_ACCOUNTS_APPROVAL',
      'SOMETHING_ELSE',
    ])(
      'an order in %s is invoiced: invoice, receivable, ledger entry and a balanced three-line journal',
      async (status) => {
        seedOrder(status);
        const seeded = { ...fake.orders.get(ORDER) };
        const res = await post(body());
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          invoiceNumber: 'SI24/26-27/00001',
          salesOrderId: ORDER,
          dispatchOrderId: DISPATCH,
          customerName: 'Acme Industries',
          taxableAmount: 100000,
          gstAmount: 18000,
          cgstAmount: 0,
          sgstAmount: 0,
          igstAmount: 18000,
          totalAmount: 118000,
          status: 'POSTED',
        });
        expect(fake.invoices).toHaveLength(1);
        expect(fake.receivables).toEqual([
          expect.objectContaining({
            salesInvoiceId: fake.invoices[0].id,
            outstandingAmount: 118000,
            paidAmount: 0,
            balanceAmount: 118000,
            paymentStatus: 'PENDING',
          }),
        ]);
        expect(fake.ledger).toEqual([
          expect.objectContaining({
            customerName: 'Acme Industries',
            salesInvoiceId: fake.invoices[0].id,
            debitAmount: 118000,
            creditAmount: 0,
            balanceAmount: 118000,
          }),
        ]);
        expect(fake.journals).toHaveLength(1);
        expect(
          fake.journalLines.map((l) => [l.debitAmount, l.creditAmount]),
        ).toEqual([
          [118000, 0],
          [0, 100000],
          [0, 18000],
        ]);
        // The order itself is never changed by invoicing.
        expect(fake.orders.get(ORDER)).toEqual(seeded);
      },
    );

    it("takes the CGST/SGST split from the Quotation's line", async () => {
      seedOrder('READY_FOR_INVOICING', { taxType: 'CGST_SGST' }, ORDER, {
        taxType: 'CGST_SGST',
      });
      Object.assign(fake.quotationLines[0], {
        cgstAmount: 9000,
        sgstAmount: 9000,
        igstAmount: 0,
      });
      const a = await post(body());
      expect(a.body).toMatchObject({
        cgstAmount: 9000,
        sgstAmount: 9000,
        igstAmount: 0,
        gstAmount: 18000,
      });
    });

    it('the customer ledger keeps its running balance across two orders of the customer', async () => {
      seedOrder('READY_FOR_INVOICING');
      seedOrder('READY_FOR_INVOICING', {}, OTHER_ORDER);
      expect((await post(body())).status).toBe(201);
      expect((await post(body({ salesOrderId: OTHER_ORDER }))).status).toBe(
        201,
      );
      expect(fake.ledger.map((l) => l.balanceAmount)).toEqual([118000, 236000]);
      expect(fake.invoices.map((i) => i.invoiceNumber)).toEqual([
        'SI24/26-27/00001',
        'SI24/26-27/00002',
      ]);
    });

    it('a live order that was never cancelled is invoiced the same way before and after a different order is cancelled', async () => {
      seedOrder('READY_FOR_INVOICING');
      seedOrder('CANCELLED', {}, OTHER_ORDER);
      expect((await post(body())).status).toBe(201);
    });
  });

  // =========================================================================
  describe('the existing checks and their order are unchanged', () => {
    it('a Dispatch Order that is not DISPATCHED is still refused first, with the same message, even for a cancelled order', async () => {
      seedOrder('CANCELLED');
      fake.dispatchOrders.set(DISPATCH, {
        id: DISPATCH,
        status: 'LOGISTICS_PREPARING',
      });
      const before = snap();
      expect(await errorOf(service.create(body()))).toBe(
        'Dispatch Order must be DISPATCHED',
      );
      expect(
        await errorOf(service.create(body({ dispatchOrderId: uid(999) }))),
      ).toBe('Dispatch Order must be DISPATCHED');
      expect(snap()).toBe(before);
    });

    it('an unknown Sales Order is still "Sales Order not found"', async () => {
      const before = snap();
      expect(
        await errorOf(service.create(body({ salesOrderId: uid(999) }))),
      ).toBe('Sales Order not found');
      expect(snap()).toBe(before);
    });

    it('a request body that fails validation is still a 400 and writes nothing', async () => {
      seedOrder('READY_FOR_INVOICING');
      const before = snap();
      expect((await post({ dispatchOrderId: DISPATCH })).status).toBe(400);
      expect((await post(body({ status: 'POSTED' }))).status).toBe(400);
      expect(snap()).toBe(before);
    });

    it('the guarded insert is atomic: if it fails nothing is written and the order is untouched', async () => {
      seedOrder('READY_FOR_INVOICING');
      fake.failInvoiceInsert = true;
      const before = snap();
      expect(await errorOf(service.create(body()))).toBe(
        'invoice insert failed',
      );
      expect(snap()).toBe(before);
    });
  });

  // =========================================================================
  describe('amounts, numbers and lines come from the Quotation the order was built from', () => {
    const refusedWithNothingWritten = async (
      res: request.Response,
      status: number,
      message: RegExp,
    ) => {
      expect(res.status).toBe(status);
      expect(res.body.message).toMatch(message);
      expect(fake.invoices).toHaveLength(0);
      expect(fake.invoiceItems).toHaveLength(0);
      expect(fake.receivables).toHaveLength(0);
      expect(fake.ledger).toHaveLength(0);
      expect(fake.journals).toHaveLength(0);
      expect([...fake.counters.values()].every((n) => n === 0)).toBe(true);
    };

    it("never adds GST on top of an order total that already includes it (the order's total is its Quotation's)", async () => {
      seedOrder('READY_FOR_INVOICING');
      const res = await post(body());
      expect(res.body).toMatchObject({
        taxableAmount: 100000,
        gstAmount: 18000,
        totalAmount: 118000,
      });
      // before this change: taxable = order total 1,18,000 and 18% added again
      expect(res.body.totalAmount).not.toBe(139240);
    });

    it("copies the Quotation's priced lines onto the invoice, as stored", async () => {
      seedOrder('READY_FOR_INVOICING');
      const res = await post(body());
      expect(fake.invoiceItems).toEqual([
        expect.objectContaining({
          salesInvoiceId: res.body.id,
          sourceLineId: `ql-${ORDER}`,
          lineNumber: 1,
          productId: 'item-pump',
          description: 'Industrial pump',
          hsnCode: '84137090',
          quantity: 4,
          rate: 25000,
          taxableAmount: 100000,
          gstRate: 18,
          igstAmount: 18000,
          cgstAmount: 0,
          sgstAmount: 0,
          gstAmount: 18000,
          totalAmount: 118000,
        }),
      ]);
    });

    it("an order made from a Proforma uses the Proforma's copy of the lines", async () => {
      seedOrder('READY_FOR_INVOICING', {
        quotationId: null,
        proformaInvoiceId: 'pi-1',
      });
      fake.proformas.set('pi-1', { id: 'pi-1', quotationId: `q-${ORDER}` });
      fake.proformaLines.push({
        ...fake.quotationLines[0],
        id: 'pl-1',
        proformaInvoiceId: 'pi-1',
      });
      expect((await post(body())).status).toBe(201);
      expect(fake.invoiceItems[0].sourceLineId).toBe('pl-1');
    });

    it('a Quotation stored before lines existed is invoiced from its amounts, with the GST split by its tax type and no items', async () => {
      seedOrder('READY_FOR_INVOICING', { taxType: 'CGST_SGST' }, ORDER, {
        taxType: 'CGST_SGST',
      });
      fake.quotationLines.length = 0;
      const res = await post(body());
      expect(res.body).toMatchObject({
        cgstAmount: 9000,
        sgstAmount: 9000,
        igstAmount: 0,
        totalAmount: 118000,
      });
      expect(fake.invoiceItems).toHaveLength(0);
    });

    it.each([
      [
        'an order not made from a Quotation',
        () => seedOrder('READY_FOR_INVOICING', { quotationId: null }),
        /not created from a Quotation/,
      ],
      [
        'a legacy Quotation without a tax breakdown',
        () =>
          seedOrder('READY_FOR_INVOICING', {}, ORDER, {
            taxableAmount: 0,
            gstPercent: 0,
            gstAmount: 0,
          }),
        /no complete tax breakdown/,
      ],
      [
        'a Quotation without a tax type',
        () => seedOrder('READY_FOR_INVOICING', {}, ORDER, { taxType: null }),
        /no complete tax breakdown/,
      ],
      [
        "a legacy order whose total is not its Quotation's total including GST",
        () => seedOrder('READY_FOR_INVOICING', { totalAmount: 100000 }),
        /is not its Quotation's total including GST/,
      ],
      [
        'an order without a seller registration',
        () =>
          seedOrder('READY_FOR_INVOICING', { sellerGstId: null }, ORDER, {
            sellerGstId: null,
          }),
        /no seller GST registration/,
      ],
      [
        'an inactive seller registration',
        () => {
          seedOrder('READY_FOR_INVOICING');
          fake.sellers.get(SELLER).isActive = false;
        },
        /seller GST registration of this Sales Order is inactive/,
      ],
      [
        'an opportunity that is not linked to a customer',
        () => {
          seedOrder('READY_FOR_INVOICING');
          fake.opportunities.set(OPP, { customerId: null });
        },
        /not linked to a customer/,
      ],
      [
        'a buyer registration of another customer',
        () => {
          seedOrder('READY_FOR_INVOICING');
          fake.buyers.set(BUYER, { id: BUYER, customerId: 'someone-else' });
        },
        /no buyer GST registration of its customer/,
      ],
      [
        "lines that do not add up to the Quotation's amounts",
        () => {
          seedOrder('READY_FOR_INVOICING');
          fake.quotationLines[0].taxableAmount = 99999;
        },
        /do not add up/,
      ],
    ])(
      'refuses %s (409): nothing is written and no number is taken',
      async (_n, arrange, message) => {
        arrange();
        await refusedWithNothingWritten(await post(body()), 409, message);
      },
    );

    it('an order is invoiced once: a second invoice for it is refused (409)', async () => {
      seedOrder('READY_FOR_INVOICING');
      expect((await post(body())).status).toBe(201);
      const again = await post(body());
      expect(again.status).toBe(409);
      expect(again.body.message).toBe(ALREADY_INVOICED_MESSAGE);
      expect(fake.invoices).toHaveLength(1);
      expect(fake.receivables).toHaveLength(1);
      expect(fake.counters.get('SALES_INVOICE|seller-24|2026-27')).toBe(1);
    });

    it('two invoices for the same order at the same moment: one is issued, the other waits for it and is refused', async () => {
      seedOrder('READY_FOR_INVOICING');
      const [a, b] = await Promise.all([post(body()), post(body())]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(fake.invoices).toHaveLength(1);
      expect(fake.counters.get('SALES_INVOICE|seller-24|2026-27')).toBe(1);
    });

    it("the customer is the order's customer: a different name is refused (400); the same name in another case or spacing is accepted; none is fine", async () => {
      seedOrder('READY_FOR_INVOICING');
      seedOrder('READY_FOR_INVOICING', {}, OTHER_ORDER);
      await refusedWithNothingWritten(
        await post(body({ customerName: 'Somebody Else' })),
        400,
        /does not match the Sales Order's customer \(Acme Industries\)/,
      );
      expect(
        (await post(body({ customerName: '  acme   INDUSTRIES ' }))).status,
      ).toBe(201);
      const res = await post(
        body({ salesOrderId: OTHER_ORDER, customerName: undefined }),
      );
      expect(res.status).toBe(201);
      expect(res.body.customerName).toBe('Acme Industries');
    });

    it.each([
      ['not a date', { invoiceDate: '07/10/2026' }],
      ['a timestamp, not a day', { invoiceDate: '2026-10-07T10:00:00Z' }],
      ['an impossible day', { invoiceDate: '2026-02-30' }],
      ['later than today', { invoiceDate: '2999-01-01' }],
    ])('refuses an invoice date that is %s (400)', async (_n, over) => {
      seedOrder('READY_FOR_INVOICING');
      const res = await post(body(over));
      expect(res.status).toBe(400);
      expect(fake.invoices).toHaveLength(0);
    });

    it('numbers follow dates: an invoice dated before the last one in its series is refused (409) and gives its number back', async () => {
      seedOrder('READY_FOR_INVOICING');
      seedOrder('READY_FOR_INVOICING', {}, OTHER_ORDER);
      expect((await post(body({ invoiceDate: '2026-10-07' }))).status).toBe(
        201,
      );
      const res = await post(
        body({ salesOrderId: OTHER_ORDER, invoiceDate: '2026-10-06' }),
      );
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(
        /earlier than invoice SI24\/26-27\/00001 \(2026-10-07\)/,
      );
      expect(fake.invoices).toHaveLength(1);
      expect(fake.counters.get('SALES_INVOICE|seller-24|2026-27')).toBe(1);
      // the same day is fine, and takes the next number
      const same = await post(
        body({ salesOrderId: OTHER_ORDER, invoiceDate: '2026-10-07' }),
      );
      expect(same.body.invoiceNumber).toBe('SI24/26-27/00002');
    });

    it('a new financial year starts a new series', async () => {
      seedOrder('READY_FOR_INVOICING');
      const res = await post(body({ invoiceDate: '2026-03-31' }));
      expect(res.body.invoiceNumber).toBe('SI24/25-26/00001');
    });
  });

  // =========================================================================
  describe('against a RevenueOS cancellation that is running at the same moment', () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const hold = (name: string) => {
      let release!: () => void;
      const gated = new Promise<void>((r) => {
        release = r;
      });
      fake.gates[name] = () => gated;
      return release;
    };
    const outcome = async (p: Promise<unknown>) => (await errorOf(p)) ?? 'ok';
    const cancel = () => cancelService.cancel(ORDER, USER, { reason: 'race' });

    // The cancellation has locked the order and is part-way through its checks
    // when the invoice request arrives.
    const invoiceArrivesDuringCancel = async () => {
      const release = hold('dispatchOrder.count:after');
      const cancelling = outcome(cancel());
      await wait(25);
      const invoicing = outcome(service.create(body()));
      await wait(25);
      release();
      return { cancelling: await cancelling, invoicing: await invoicing };
    };
    // The invoice has passed its check and is held just before inserting when
    // the cancellation arrives.
    const cancelArrivesDuringInvoice = async () => {
      const release = hold('salesInvoice.create:before');
      const invoicing = outcome(service.create(body()));
      await wait(25);
      const cancelling = outcome(cancel());
      await wait(25);
      release();
      return { cancelling: await cancelling, invoicing: await invoicing };
    };
    // Whatever interleaving happened, an invoice never exists for a cancelled
    // order, and a cancelled order never has an invoice.
    const expectNoInvoiceOnCancelled = () => {
      const cancelled = fake.orders.get(ORDER).status === 'CANCELLED';
      if (cancelled) expect(fake.invoices).toHaveLength(0);
      if (fake.invoices.length > 0)
        expect(fake.orders.get(ORDER).status).not.toBe('CANCELLED');
    };

    beforeEach(() => seedOrder('READY_FOR_DISPATCH_ORDER'));

    it('the cancellation holds the order, the invoice arrives: it waits, then is refused (409), and nothing at all is written for it', async () => {
      const r = await invoiceArrivesDuringCancel();
      expect(r.cancelling).toBe('ok');
      expect(r.invoicing).toBe(CANCELLED_MESSAGE);
      expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
      expect(writes()).toBe(
        JSON.stringify({ i: [], r: [], l: [], j: [], jl: [] }),
      );
      expectNoInvoiceOnCancelled();
    });

    it('the invoice has passed its check, the cancellation arrives: the cancellation waits for the invoice, sees it, and refuses (409); the order is not cancelled', async () => {
      const r = await cancelArrivesDuringInvoice();
      expect(r.invoicing).toBe('ok');
      expect(r.cancelling).toMatch(/already has a Sales Invoice/);
      expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
      expect(fake.invoices).toHaveLength(1);
      expect(
        fake.events.filter((e) => e.action === 'SALES_ORDER_CANCELLED'),
      ).toHaveLength(0);
      expectNoInvoiceOnCancelled();
    });

    it('60 rounds of invoice and cancellation racing in either order: exactly one wins every time', async () => {
      let invoiced = 0;
      let cancelled = 0;
      for (let round = 0; round < 60; round += 1) {
        for (const rows of [
          fake.invoices,
          fake.receivables,
          fake.ledger,
          fake.journals,
          fake.journalLines,
          fake.events,
        ])
          rows.length = 0;
        seedOrder('READY_FOR_DISPATCH_ORDER');
        const invoiceCall = () => outcome(service.create(body()));
        const cancelCall = () => outcome(cancel());
        const first = round % 2 ? invoiceCall : cancelCall;
        const second = round % 2 ? cancelCall : invoiceCall;
        const [r1, r2] = await Promise.all([
          first(),
          wait(round % 4).then(second),
        ]);
        const invoiceOk = (round % 2 ? r1 : r2) === 'ok';
        const cancelOk = (round % 2 ? r2 : r1) === 'ok';
        expect(invoiceOk !== cancelOk).toBe(true);
        if (invoiceOk) invoiced += 1;
        else cancelled += 1;
        expectNoInvoiceOnCancelled();
      }
      expect(invoiced).toBeGreaterThan(0);
      expect(cancelled).toBeGreaterThan(0);
    });

    // -----------------------------------------------------------------------
    describe('negative controls: without the guard, or without its lock, the same interleavings are caught', () => {
      it('with no guard at all (as before this checkpoint) an invoice is written for a cancelled order, with its receivable, ledger entry and journal', async () => {
        jest
          .spyOn(invoiceLock, 'lockSalesOrderForInvoice')
          .mockResolvedValue('READY_FOR_DISPATCH_ORDER'); // the guard never sees CANCELLED
        const r = await invoiceArrivesDuringCancel();
        expect(r.cancelling).toBe('ok');
        expect(r.invoicing).toBe('ok'); // it should have been refused
        expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
        expect(fake.invoices).toHaveLength(1);
        expect(fake.receivables).toHaveLength(1);
        expect(fake.ledger).toHaveLength(1);
        expect(fake.journals).toHaveLength(1);
        expect(() => expectNoInvoiceOnCancelled()).toThrow();
      });

      it('with the check but no lock, an invoice that passed the check is written after the cancellation, over a cancelled order', async () => {
        jest
          .spyOn(invoiceLock, 'lockSalesOrderForInvoice')
          .mockImplementation(async (tx: any, id: string) => {
            const rows =
              await tx.$queryRaw`SELECT "status" FROM "SalesOrder" WHERE "id" = ${id}`;
            return rows[0].status as string;
          });
        const r = await cancelArrivesDuringInvoice();
        expect(r.invoicing).toBe('ok');
        expect(r.cancelling).toBe('ok'); // the cancellation never saw the invoice
        expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
        expect(fake.invoices).toHaveLength(1);
        expect(() => expectNoInvoiceOnCancelled()).toThrow();
      });
    });
  });
});
