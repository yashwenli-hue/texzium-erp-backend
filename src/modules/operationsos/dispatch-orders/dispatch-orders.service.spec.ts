/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- the fake database is intentionally loosely typed */
import { AccountsCommercialApprovalService } from '../../revenueos/accounts-commercial-approval/accounts-commercial-approval.service';
import { SalesOrdersService } from '../../revenueos/sales-orders/sales-orders.service';
import { DispatchOrdersService } from './dispatch-orders.service';

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ORDER = uid(1);
const APPROVAL = uid(51);
const USER = 'user-1';

// ---------------------------------------------------------------------------
// A stateful fake of the database dispatch creation, cancellation and approval
// retraction use. It has real compare-and-set semantics for updateMany, real
// transaction rollback (an undo journal per transaction) and PostgreSQL's
// row-lock rules (FOR KEY SHARE, FOR SHARE, FOR NO KEY UPDATE, FOR UPDATE with
// the real conflict matrix, held until the transaction ends). A statement that
// waits re-checks its condition once it gets the lock. Inserting a row that
// points at a Sales Order takes FOR KEY SHARE on the order (the foreign-key
// check). `stripCas` removes the status condition from every updateMany on the
// order, for the negative controls. `gates` hold a call before or after it
// runs so a test can force an exact interleaving.
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
  dispatchOrders: any[] = [];
  approvals: any[] = [];
  events: any[] = [];
  users = new Map<string, any>([
    [USER, { id: USER, fullName: 'Asha Accounts' }],
  ]);
  clock = 0;
  seq = 100;
  stripCas = false;
  failDispatchInsert = false;
  failOrderUpdate = false;
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

  private matches(row: any, where: any, cas = false) {
    return Object.entries(where).every(([k, v]) => {
      if (cas && this.stripCas && k === 'status') return true;
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
    const updateMany = (rows: () => any[], table: string, cas: boolean) =>
      jest.fn(async (args: any) => {
        let count = 0;
        const candidates = rows().filter(
          (r) => args.where.id === undefined || r.id === args.where.id,
        );
        for (const row of candidates) {
          if (inTx)
            await self.lock(owner, `${table}:${row.id}`, 'NO_KEY_UPDATE');
          if (self.matches(row, args.where, cas)) {
            if (table === 'order' && self.failOrderUpdate) {
              throw new Error('order update failed');
            }
            const before = { ...row };
            Object.assign(row, args.data);
            undo(() => Object.assign(row, before));
            count += 1;
          }
        }
        return { count };
      });
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
        updateMany: updateMany(() => [...self.orders.values()], 'order', true),
      },
      dispatchOrder: {
        count: jest.fn(async (a: any) => {
          const n = self.dispatchOrders.filter((x) =>
            self.matches(x, a.where),
          ).length;
          await gate('dispatchOrder.count:after');
          return n;
        }),
        create: jest.fn(async (a: any) => {
          await gate('dispatchOrder.create:before');
          if (self.failDispatchInsert)
            throw new Error('dispatch insert failed');
          const sid = a.data.salesOrderId;
          if (sid) {
            if (!self.orders.has(sid)) {
              throw new Error(
                'Foreign key constraint failed (DispatchOrder_salesOrderId_fkey)',
              );
            }
            if (inTx) await self.lock(owner, `order:${sid}`, 'KEY_SHARE');
          }
          const row = self.stamp({
            id: self.nextId(),
            createdAt: new Date(),
            ...a.data,
          });
          self.dispatchOrders.push(row);
          undo(() =>
            self.dispatchOrders.splice(self.dispatchOrders.indexOf(row), 1),
          );
          return { ...row };
        }),
      },
      dispatch: none(),
      salesInvoice: none(),
      purchaseRequisition: none(),
      purchaseOrder: none(),
      inventoryReservation: none(),
      salesOrderEvent: {
        create: jest.fn(async (a: any) => {
          const row = self.stamp({
            id: self.nextId(),
            createdAt: new Date(),
            ...a.data,
          });
          self.events.push(row);
          undo(() => self.events.splice(self.events.indexOf(row), 1));
          return { ...row };
        }),
        findFirst: jest.fn(async (a: any) => {
          const e = self.events.find((x) => self.matches(x, a.where));
          return e ? { id: e.id } : null;
        }),
      },
      accountsCommercialApproval: {
        findUnique: jest.fn(async (a: any) => {
          const x = self.approvals.find((r) => r.id === a.where.id);
          if (!x) return null;
          return a.select
            ? Object.fromEntries(Object.keys(a.select).map((k) => [k, x[k]]))
            : { ...x };
        }),
        updateMany: updateMany(() => self.approvals, 'approval', false),
      },
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, id: string) => {
        const sql = strings.join('?').replace(/\s+/g, ' ');
        if (!sql.includes('FROM "SalesOrder"') || !sql.includes('FOR UPDATE')) {
          throw new Error(`unexpected raw query: ${sql}`);
        }
        if (inTx) await self.lock(owner, `order:${id}`, 'UPDATE');
        const o = self.orders.get(id);
        return o ? [{ status: o.status }] : [];
      }),
    };

    // Every call yields first (a database round trip), so overlapping
    // transactions really interleave; named gates can hold a call after it ran.
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

// The algorithm this checkpoint replaced, verbatim in behaviour: read the
// status, insert the Dispatch Order, then update the status unconditionally,
// each as its own statement. Kept only as a negative control: the same
// interleavings that the new code survives must break it.
async function legacyCreate(prisma: any, data: any) {
  if (data.dispatchSource === 'SALES_ORDER') {
    if (!data.salesOrderId) throw new Error('Sales Order is required.');
    const salesOrder = await prisma.salesOrder.findUnique({
      where: { id: data.salesOrderId },
    });
    if (!salesOrder) throw new Error('Sales Order not found.');
    if (salesOrder.status !== 'READY_FOR_DISPATCH_ORDER') {
      throw new Error('Sales Order is not ready for dispatch.');
    }
  }
  const dispatchOrder = await prisma.dispatchOrder.create({
    data: {
      dispatchSource: data.dispatchSource,
      salesOrderId: data.salesOrderId,
      status: 'LOGISTICS_PREPARING',
    },
  });
  if (data.salesOrderId) {
    await prisma.salesOrder.updateMany({
      where: { id: data.salesOrderId },
      data: { status: 'DISPATCH_ORDER_CREATED' },
    });
  }
  return dispatchOrder;
}

describe('DispatchOrdersService.create', () => {
  let fake: FakeDb;
  let dispatch: DispatchOrdersService;
  let cancelService: SalesOrdersService;
  let approvalService: AccountsCommercialApprovalService;

  beforeEach(() => {
    fake = new FakeDb();
    const prisma = fake.root();
    // create() uses neither the issue nor the inventory-lock service.
    dispatch = new DispatchOrdersService(prisma, {} as any, {} as any);
    cancelService = new SalesOrdersService(prisma);
    approvalService = new AccountsCommercialApprovalService(prisma);
  });

  const seedOrder = (status: string, id = ORDER) =>
    fake.orders.set(id, { id, status, totalAmount: 275000 });
  const sales = (extra: any = {}) => ({
    dispatchSource: 'SALES_ORDER',
    salesOrderId: ORDER,
    ...extra,
  });
  const direct = (extra: any = {}) => ({
    dispatchSource: 'DIRECT_DISPATCH',
    customerName: 'Walk-in Customer',
    dispatchReason: 'Sample',
    ...extra,
  });
  const errorOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return (e as Error).message;
    }
    return null;
  };
  const snap = () =>
    JSON.stringify({
      o: [...fake.orders.values()],
      d: fake.dispatchOrders,
      e: fake.events,
      a: fake.approvals,
    });

  // Orders go through the real RevenueOS actions, so events are real.
  const approvedOrder = () => {
    seedOrder('READY_FOR_DISPATCH_ORDER');
    fake.approvals.push({
      id: APPROVAL,
      salesOrderId: ORDER,
      status: 'APPROVED',
      approvedBy: 'Asha',
    });
    fake.stamp({}); // advance the clock
    fake.events.push(
      fake.stamp({
        id: fake.nextId(),
        salesOrderId: ORDER,
        action: 'ACCOUNTS_APPROVED',
        referenceId: APPROVAL,
        fromStatus: 'PENDING_ACCOUNTS_APPROVAL',
        toStatus: 'READY_FOR_DISPATCH_ORDER',
        actorId: USER,
      }),
    );
  };
  const cancel = () => cancelService.cancel(ORDER, USER, { reason: 'race' });
  const retractApproval = () =>
    approvalService.retract(APPROVAL, USER, { reason: 'race' });

  // The invariants that must hold for the order after any mix of dispatch,
  // cancel and retract: a Dispatch Order exists exactly when the order
  // reached DISPATCH_ORDER_CREATED, and a cancelled or retracted order has none.
  const expectNoOrphan = (id = ORDER) => {
    const order = fake.orders.get(id);
    const dos = fake.dispatchOrders.filter((x) => x.salesOrderId === id);
    if (dos.length > 0) {
      expect(order.status).toBe('DISPATCH_ORDER_CREATED');
      expect(dos).toHaveLength(1);
      // RevenueOS never cancelled or retracted an order that has a Dispatch
      // Order: either it was refused, or it came first and the dispatch was.
      expect(
        fake.events.filter(
          (x) => x.salesOrderId === id && /CANCELLED|RETRACTED/.test(x.action),
        ),
      ).toHaveLength(0);
      expect(order.status).not.toBe('CANCELLED');
    } else {
      expect(order.status).not.toBe('DISPATCH_ORDER_CREATED');
    }
  };

  // =========================================================================
  describe('a Sales Order dispatch (dispatchSource SALES_ORDER)', () => {
    it('creates the Dispatch Order and moves the order READY_FOR_DISPATCH_ORDER -> DISPATCH_ORDER_CREATED', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      const created = await dispatch.create(
        sales({
          referenceId: 'ref-1',
          customerName: 'Acme',
          dispatchDate: '2026-10-07',
          expectedDelivery: '2026-10-09T00:00:00.000Z',
          transportName: 'Blue Dart',
          vehicleNumber: 'MH12AB1234',
          driverName: 'Ravi',
          remarks: 'Handle with care',
        }),
      );
      expect(created).toMatchObject({
        dispatchSource: 'SALES_ORDER',
        referenceId: 'ref-1',
        salesOrderId: ORDER,
        customerName: 'Acme',
        isCommercial: true,
        transportName: 'Blue Dart',
        vehicleNumber: 'MH12AB1234',
        driverName: 'Ravi',
        remarks: 'Handle with care',
        status: 'LOGISTICS_PREPARING',
      });
      expect(created.dispatchOrderNo).toMatch(/^DO-\d+$/);
      expect(created.dispatchDate).toEqual(new Date('2026-10-07'));
      expect(created.expectedDelivery).toEqual(
        new Date('2026-10-09T00:00:00.000Z'),
      );
      expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
      expect(fake.dispatchOrders).toHaveLength(1);
      expect(fake.orders.get(ORDER).totalAmount).toBe(275000); // nothing else on the order changed
    });

    it('isCommercial defaults to true and can be set to false; missing optional dates are stored as null', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      const a = await dispatch.create(sales({ isCommercial: false }));
      expect(a.isCommercial).toBe(false);
      expect(a.dispatchDate).toBeNull();
      expect(a.expectedDelivery).toBeNull();
    });

    it('a missing Sales Order id -> "Sales Order is required.", and nothing is touched', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      const before = snap();
      expect(
        await errorOf(dispatch.create({ dispatchSource: 'SALES_ORDER' })),
      ).toBe('Sales Order is required.');
      expect(snap()).toBe(before);
    });

    it('an unknown Sales Order -> "Sales Order not found.", and nothing is written', async () => {
      const before = snap();
      expect(
        await errorOf(dispatch.create(sales({ salesOrderId: uid(999) }))),
      ).toBe('Sales Order not found.');
      expect(snap()).toBe(before);
    });

    it.each([
      'PENDING_STORE_APPROVAL',
      'PENDING_ACCOUNTS_APPROVAL',
      'OPEN',
      'DISPATCH_ORDER_CREATED',
      'READY_FOR_INVOICING',
      'CANCELLED',
      'SOMETHING_ELSE',
    ])(
      'an order in %s -> "Sales Order is not ready for dispatch.", no Dispatch Order, status unchanged',
      async (status) => {
        seedOrder(status);
        const before = snap();
        expect(await errorOf(dispatch.create(sales()))).toBe(
          'Sales Order is not ready for dispatch.',
        );
        expect(snap()).toBe(before);
        expect(fake.dispatchOrders).toHaveLength(0);
        expect(fake.orders.get(ORDER).status).toBe(status);
      },
    );

    it('a CANCELLED order can never be advanced by dispatch creation', async () => {
      seedOrder('CANCELLED');
      for (const source of ['SALES_ORDER', 'DIRECT_DISPATCH', undefined]) {
        expect(
          await errorOf(
            dispatch.create({
              ...direct(),
              dispatchSource: source,
              salesOrderId: ORDER,
            }),
          ),
        ).toBe('Sales Order is not ready for dispatch.');
      }
      expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
      expect(fake.dispatchOrders).toHaveLength(0);
    });

    it('a second dispatch for the same order is refused: exactly one Dispatch Order', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      await dispatch.create(sales());
      expect(await errorOf(dispatch.create(sales()))).toBe(
        'Sales Order is not ready for dispatch.',
      );
      expect(fake.dispatchOrders).toHaveLength(1);
    });

    it('10 simultaneous dispatches for one order: exactly one succeeds and exactly one Dispatch Order exists', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => dispatch.create(sales())),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        results
          .filter((r) => r.status === 'rejected')
          .every(
            (r) =>
              (r as any).reason.message ===
              'Sales Order is not ready for dispatch.',
          ),
      ).toBe(true);
      expect(fake.dispatchOrders).toHaveLength(1);
      expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
    });

    it('is atomic: if the Dispatch Order cannot be inserted the order is still READY_FOR_DISPATCH_ORDER', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      fake.failDispatchInsert = true;
      expect(await errorOf(dispatch.create(sales()))).toBe(
        'dispatch insert failed',
      );
      expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
      expect(fake.dispatchOrders).toHaveLength(0);
    });

    it('is atomic: if the order cannot be updated no Dispatch Order is left behind', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      fake.failOrderUpdate = true;
      expect(await errorOf(dispatch.create(sales()))).toBe(
        'order update failed',
      );
      expect(fake.dispatchOrders).toHaveLength(0);
      expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
    });
  });

  // =========================================================================
  describe('other dispatch sources keep their behaviour and messages', () => {
    it('DIRECT_DISPATCH needs a customer name first, then a reason, with the same messages, before touching anything', async () => {
      const before = snap();
      expect(
        await errorOf(dispatch.create({ dispatchSource: 'DIRECT_DISPATCH' })),
      ).toBe('Customer Name is required.');
      expect(
        await errorOf(
          dispatch.create({
            dispatchSource: 'DIRECT_DISPATCH',
            customerName: 'X',
          }),
        ),
      ).toBe('Dispatch Reason is required.');
      expect(snap()).toBe(before);
    });

    it('DIRECT_DISPATCH without a Sales Order creates the Dispatch Order and touches no order', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      const created = await dispatch.create(direct());
      expect(created).toMatchObject({
        dispatchSource: 'DIRECT_DISPATCH',
        customerName: 'Walk-in Customer',
        dispatchReason: 'Sample',
        status: 'LOGISTICS_PREPARING',
        salesOrderId: undefined,
      });
      expect(created.dispatchOrderNo).toMatch(/^DO-\d+$/);
      expect(fake.orders.get(ORDER).status).toBe('READY_FOR_DISPATCH_ORDER');
      expect(fake.dispatchOrders).toHaveLength(1);
    });

    it.each([
      'PENDING_STORE_APPROVAL',
      'OPEN',
      'READY_FOR_DISPATCH_ORDER',
      'READY_FOR_INVOICING',
    ])(
      'a non-SALES_ORDER dispatch that names a %s order still marks it DISPATCH_ORDER_CREATED, exactly as before',
      async (status) => {
        seedOrder(status);
        for (const source of ['DIRECT_DISPATCH', undefined]) {
          seedOrder(status);
          fake.dispatchOrders.length = 0;
          await dispatch.create({
            ...direct(),
            dispatchSource: source,
            salesOrderId: ORDER,
          });
          expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
          expect(fake.dispatchOrders).toHaveLength(1);
          expect(fake.dispatchOrders[0].salesOrderId).toBe(ORDER);
        }
      },
    );

    it('a non-SALES_ORDER dispatch for a CANCELLED order is refused: it never overwrites CANCELLED and leaves no Dispatch Order', async () => {
      seedOrder('CANCELLED');
      const before = snap();
      expect(
        await errorOf(dispatch.create(direct({ salesOrderId: ORDER }))),
      ).toBe('Sales Order is not ready for dispatch.');
      expect(snap()).toBe(before);
    });

    it('a non-SALES_ORDER dispatch for an unknown order fails as before (the insert breaks on its foreign key) and leaves nothing', async () => {
      const before = snap();
      expect(
        await errorOf(dispatch.create(direct({ salesOrderId: uid(999) }))),
      ).toMatch(/Foreign key constraint/);
      expect(snap()).toBe(before);
    });

    it('another order is never touched', async () => {
      seedOrder('READY_FOR_DISPATCH_ORDER');
      seedOrder('READY_FOR_DISPATCH_ORDER', uid(2));
      await dispatch.create(sales());
      expect(fake.orders.get(uid(2)).status).toBe('READY_FOR_DISPATCH_ORDER');
    });
  });

  // =========================================================================
  describe('against a RevenueOS cancellation or approval retraction', () => {
    const hold = (name: string) => {
      let release!: () => void;
      const gated = new Promise<void>((r) => {
        release = r;
      });
      fake.gates[name] = () => gated;
      return release;
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const outcome = async (p: Promise<unknown>) => (await errorOf(p)) ?? 'ok';

    // A cancel / retract that has locked the order and is part-way through its
    // checks when the dispatch request arrives.
    const dispatchArrivesDuringRevenueOS = async (
      act: () => Promise<unknown>,
    ) => {
      const release = hold('dispatchOrder.count:after'); // the cancel/retract's downstream check
      const acting = outcome(act());
      await wait(25); // it now holds the order lock
      const dispatching = outcome(dispatch.create(sales()));
      await wait(25);
      release();
      return { acting: await acting, dispatching: await dispatching };
    };
    // A dispatch that has claimed the order and is held before inserting its
    // Dispatch Order when the cancel / retract arrives.
    const revenueOSArrivesDuringDispatch = async (
      act: () => Promise<unknown>,
    ) => {
      const release = hold('dispatchOrder.create:before');
      const dispatching = outcome(dispatch.create(sales()));
      await wait(25); // it has claimed the order
      const acting = outcome(act());
      await wait(25);
      release();
      return { acting: await acting, dispatching: await dispatching };
    };

    it('cancel holds the order, dispatch arrives: the dispatch is refused, the order stays CANCELLED, and no Dispatch Order exists', async () => {
      approvedOrder();
      const r = await dispatchArrivesDuringRevenueOS(cancel);
      expect(r).toEqual({
        acting: 'ok',
        dispatching: 'Sales Order is not ready for dispatch.',
      });
      expect(fake.orders.get(ORDER).status).toBe('CANCELLED');
      expect(fake.dispatchOrders).toHaveLength(0);
      expectNoOrphan();
    });

    it('retract-approval holds the order, dispatch arrives: the dispatch is refused, the order is back at PENDING_ACCOUNTS_APPROVAL, and no Dispatch Order exists', async () => {
      approvedOrder();
      const r = await dispatchArrivesDuringRevenueOS(retractApproval);
      expect(r).toEqual({
        acting: 'ok',
        dispatching: 'Sales Order is not ready for dispatch.',
      });
      expect(fake.orders.get(ORDER).status).toBe('PENDING_ACCOUNTS_APPROVAL');
      expect(fake.approvals[0].status).toBe('RETRACTED');
      expect(fake.dispatchOrders).toHaveLength(0);
      expectNoOrphan();
    });

    it('dispatch has claimed the order, cancel arrives: the cancel waits, then is refused (409) because a Dispatch Order now exists', async () => {
      approvedOrder();
      const r = await revenueOSArrivesDuringDispatch(cancel);
      expect(r.dispatching).toBe('ok');
      expect(r.acting).toMatch(
        /cannot be cancelled here \(now Dispatch Order Created\)/,
      );
      expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
      expect(fake.dispatchOrders).toHaveLength(1);
      expect(
        fake.events.filter((e) => e.action === 'SALES_ORDER_CANCELLED'),
      ).toHaveLength(0);
      expectNoOrphan();
    });

    it('dispatch has claimed the order, approval retraction arrives: it waits, then is refused (409), the approval stays in force', async () => {
      approvedOrder();
      const r = await revenueOSArrivesDuringDispatch(retractApproval);
      expect(r.dispatching).toBe('ok');
      expect(r.acting).toMatch(
        /An accounts approval can only be retracted while the Sales Order is Ready For Dispatch Order \(now Dispatch Order Created\)/,
      );
      expect(fake.approvals[0].status).toBe('APPROVED');
      expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
      expect(fake.dispatchOrders).toHaveLength(1);
      expectNoOrphan();
    });

    it.each([
      ['cancel', 'cancel'],
      ['approval retraction', 'retract'],
    ])(
      '%s racing a dispatch in either order, 40 rounds: exactly one side wins and no orphan Dispatch Order can result',
      async (_n, which) => {
        let dispatchWins = 0;
        let revenueWins = 0;
        for (let round = 0; round < 40; round += 1) {
          fake = new FakeDb();
          const prisma = fake.root();
          dispatch = new DispatchOrdersService(prisma, {} as any, {} as any);
          cancelService = new SalesOrdersService(prisma);
          approvalService = new AccountsCommercialApprovalService(prisma);
          approvedOrder();
          const act = which === 'cancel' ? cancel : retractApproval;
          const revenueCall = () => outcome(act());
          const dispatchCall = () => outcome(dispatch.create(sales()));
          // Alternate which request is sent first, and stagger them by 0-3 ms.
          const first = round % 2 ? dispatchCall : revenueCall;
          const second = round % 2 ? revenueCall : dispatchCall;
          const [r1, r2] = await Promise.all([
            first(),
            wait(round % 4).then(second),
          ]);
          const revenue = (round % 2 ? r2 : r1) === 'ok';
          const dispatched = (round % 2 ? r1 : r2) === 'ok';
          expect(dispatched !== revenue).toBe(true); // exactly one wins
          if (dispatched) dispatchWins += 1;
          else revenueWins += 1;
          expectNoOrphan();
        }
        expect(dispatchWins + revenueWins).toBe(40);
        // Both outcomes occur across the rounds, so both orderings were exercised.
        expect(dispatchWins).toBeGreaterThan(0);
        expect(revenueWins).toBeGreaterThan(0);
      },
    );

    it('many dispatches racing a cancellation: never a Dispatch Order on a cancelled order', async () => {
      for (let round = 0; round < 15; round += 1) {
        fake = new FakeDb();
        const prisma = fake.root();
        dispatch = new DispatchOrdersService(prisma, {} as any, {} as any);
        cancelService = new SalesOrdersService(prisma);
        approvedOrder();
        const rs = await Promise.all([
          ...Array.from({ length: 4 }, () => outcome(dispatch.create(sales()))),
          outcome(cancel()),
          ...Array.from({ length: 4 }, () => outcome(dispatch.create(sales()))),
        ]);
        expect(rs.filter((r) => r === 'ok').length).toBe(1);
        expectNoOrphan();
      }
    });

    // -----------------------------------------------------------------------
    describe('negative controls: the same interleavings break the old algorithm, and the new one without its compare-and-set', () => {
      it('OLD algorithm: a dispatch that read READY, then a cancel, then the insert and unconditional update: a cancelled order gets a Dispatch Order and is un-cancelled', async () => {
        approvedOrder();
        const release = hold('salesOrder.findUnique:after'); // the old code has read READY and pauses
        const old = outcome(legacyCreate(fake.root(), sales()));
        await wait(25);
        const cancelled = await outcome(cancel()); // cancel sees no Dispatch Order yet and cancels
        release();
        const oldResult = await old;
        expect(cancelled).toBe('ok');
        expect(oldResult).toBe('ok');
        // The violation: the order was cancelled, yet now has a Dispatch Order and is DISPATCH_ORDER_CREATED.
        expect(fake.dispatchOrders).toHaveLength(1);
        expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
        expect(
          fake.events.some((e) => e.action === 'SALES_ORDER_CANCELLED'),
        ).toBe(true);
        expect(() => expectNoOrphan()).toThrow();
      });

      it('OLD algorithm: the same with a retracted approval: the retraction is silently overwritten', async () => {
        approvedOrder();
        const release = hold('salesOrder.findUnique:after');
        const old = outcome(legacyCreate(fake.root(), sales()));
        await wait(25);
        expect(await outcome(retractApproval())).toBe('ok');
        release();
        await old;
        expect(fake.approvals[0].status).toBe('RETRACTED');
        expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED'); // approval retracted, yet dispatched
        expect(() => expectNoOrphan()).toThrow();
      });

      it('OLD algorithm: simultaneous dispatches of one order create several Dispatch Orders', async () => {
        seedOrder('READY_FOR_DISPATCH_ORDER');
        const prisma = fake.root();
        await Promise.allSettled(
          Array.from({ length: 10 }, () => legacyCreate(prisma, sales())),
        );
        expect(fake.dispatchOrders.length).toBeGreaterThan(1);
      });

      it('NEW algorithm with the status condition removed: a dispatch that waited for a cancellation overwrites CANCELLED and inserts a Dispatch Order', async () => {
        approvedOrder();
        fake.stripCas = true; // removes the status condition from the order update, in the test only
        const r = await dispatchArrivesDuringRevenueOS(cancel);
        expect(r.acting).toBe('ok');
        expect(r.dispatching).toBe('ok'); // it should have been refused
        expect(fake.dispatchOrders).toHaveLength(1);
        expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
        expect(() => expectNoOrphan()).toThrow();
      });

      it('NEW algorithm with the status condition removed: a DIRECT_DISPATCH overwrites a CANCELLED order', async () => {
        seedOrder('CANCELLED');
        fake.stripCas = true;
        await dispatch.create(direct({ salesOrderId: ORDER }));
        expect(fake.orders.get(ORDER).status).toBe('DISPATCH_ORDER_CREATED');
      });

      it('NEW algorithm with the status condition removed: ten simultaneous dispatches create several Dispatch Orders', async () => {
        seedOrder('READY_FOR_DISPATCH_ORDER');
        fake.stripCas = true;
        await Promise.allSettled(
          Array.from({ length: 10 }, () => dispatch.create(sales())),
        );
        expect(fake.dispatchOrders.length).toBeGreaterThan(1);
      });
    });
  });
});
