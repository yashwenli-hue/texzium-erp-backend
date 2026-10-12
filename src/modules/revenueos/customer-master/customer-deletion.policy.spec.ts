/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unnecessary-type-assertion -- test doubles are intentionally loosely typed */
import {
  CUSTOMER_BLOCKER,
  CUSTOMER_DELETION_POLICY,
  CUSTOMER_RESTORE_CONFLICT,
  customerBlockers,
  normalizeName,
} from './customer-deletion.policy';

// The customer's deletion and restore rules against a database double. Financial documents
// are never deleted, so everything that could tie one to the customer blocks.

interface Facts {
  opportunities: number;
  quotations: number;
  orders: number;
  dispatchById: number;
  vendors: number;
  isVendor: boolean;
  linkedVendorId: string | null;
  events: number;
  invoices: number;
  ledger: number;
  dispatchByName: number;
  registrations: Array<{
    id: string;
    legalName: string;
    tradeName: string | null;
    updatedAt: Date;
  }>;
  missing: boolean;
  updatedAt: string;
  name: string;
  shares: number;
}
const quiet = (over: Partial<Facts> = {}): Facts => ({
  opportunities: 0,
  quotations: 0,
  orders: 0,
  dispatchById: 0,
  vendors: 0,
  isVendor: false,
  linkedVendorId: null,
  events: 2,
  invoices: 0,
  ledger: 0,
  dispatchByName: 0,
  registrations: [],
  missing: false,
  updatedAt: '2026-10-01T00:00:00.000Z',
  name: 'Sterling Pumps',
  shares: 0,
  ...over,
});

function dbFor(f: Facts) {
  const names: string[][] = [];
  const db: any = {
    names,
    customer: {
      findUnique: jest.fn(async () =>
        f.missing
          ? null
          : {
              id: 'C1',
              customerCode: 'CUST-000007',
              customerName: f.name,
              isActive: true,
              isVendor: f.isVendor,
              linkedVendorId: f.linkedVendorId,
              updatedAt: new Date(f.updatedAt),
              gstRegistrations: f.registrations,
            },
      ),
    },
    opportunity: { count: jest.fn(async () => f.opportunities) },
    quotation: { count: jest.fn(async () => f.quotations) },
    salesOrder: { count: jest.fn(async () => f.orders) },
    dispatchOrder: { count: jest.fn(async () => f.dispatchById) },
    vendor: { count: jest.fn(async () => f.vendors) },
    customerEvent: { count: jest.fn(async () => f.events) },
    contentShare: {
      count: jest.fn(async (args: any) => {
        expect(args.where).toEqual({ customerId: 'C1' });
        return f.shares;
      }),
    },
    $queryRaw: jest.fn(async (_s: any, ...values: any[]) => {
      names.push(
        values.flatMap((v) => (v && Array.isArray(v.values) ? v.values : [v])),
      );
      return [
        { invoices: f.invoices, ledger: f.ledger, dispatch: f.dispatchByName },
      ];
    }),
  };
  return db;
}
const evaluate = (f: Facts) =>
  CUSTOMER_DELETION_POLICY.evaluate(dbFor(f), 'C1');

describe('customer deletion: what blocks it', () => {
  it('nothing blocks a customer that nothing depends on (its registrations and events go with it)', async () => {
    const r = await evaluate(
      quiet({
        registrations: [
          {
            id: 'G1',
            legalName: 'Sterling Pumps Pvt Ltd',
            tradeName: null,
            updatedAt: new Date('2026-09-01'),
          },
        ],
      }),
    );
    expect(r?.blockers).toEqual([]);
    expect(r?.removes).toEqual([
      { label: 'The customer record', count: 1 },
      { label: 'GST registrations', count: 1 },
      { label: 'History events', count: 2 },
    ]);
    expect(r?.label).toBe('Sterling Pumps');
    expect(r?.code).toBe('CUSTOMER-7'.replace('CUSTOMER-7', 'CUST-000007'));
  });

  const reg = [
    {
      id: 'G1',
      legalName: 'Sterling',
      tradeName: null,
      updatedAt: new Date('2026-09-01'),
    },
  ];
  it.each([
    [
      'a linked opportunity',
      { opportunities: 1 },
      CUSTOMER_BLOCKER.OPPORTUNITIES,
      'It is linked to 1 opportunity.',
    ],
    [
      'linked opportunities',
      { opportunities: 2 },
      CUSTOMER_BLOCKER.OPPORTUNITIES,
      'It is linked to 2 opportunities.',
    ],
    [
      'a quotation using its GST registration',
      { quotations: 1, registrations: reg },
      CUSTOMER_BLOCKER.GST_IN_DOCUMENTS,
      '1 quotation or order uses its GST registrations.',
    ],
    [
      'a sales order using its GST registration',
      { orders: 2, registrations: reg },
      CUSTOMER_BLOCKER.GST_IN_DOCUMENTS,
      '2 quotations or orders use its GST registrations.',
    ],
    [
      'a dispatch order by id',
      { dispatchById: 1 },
      CUSTOMER_BLOCKER.DISPATCH_ORDERS,
      '1 dispatch order refers to it.',
    ],
    [
      'a vendor flag on the customer',
      { isVendor: true },
      CUSTOMER_BLOCKER.VENDOR_LINK,
      'It is linked to a vendor record.',
    ],
    [
      'a linked vendor id on the customer',
      { linkedVendorId: 'V1' },
      CUSTOMER_BLOCKER.VENDOR_LINK,
      'It is linked to a vendor record.',
    ],
    [
      'a vendor pointing at the customer',
      { vendors: 1 },
      CUSTOMER_BLOCKER.VENDOR_LINK,
      'It is linked to a vendor record.',
    ],
    [
      'an invoice carrying its name',
      { invoices: 1 },
      CUSTOMER_BLOCKER.NAME_IN_FINANCIAL_RECORDS,
      '1 invoice, ledger entry or dispatch order carries its name.',
    ],
    [
      'ledger entries carrying its name',
      { ledger: 3 },
      CUSTOMER_BLOCKER.NAME_IN_FINANCIAL_RECORDS,
      '3 invoices, ledger entries or dispatch orders carry its name.',
    ],
    [
      'a dispatch order carrying its name',
      { dispatchByName: 1 },
      CUSTOMER_BLOCKER.NAME_IN_FINANCIAL_RECORDS,
      '1 invoice, ledger entry or dispatch order carries its name.',
    ],
    [
      'content shared with it',
      { shares: 2 },
      CUSTOMER_BLOCKER.CONTENT_SHARED,
      'Sales content was shared with it 2 times.',
    ],
  ])(
    '%s blocks, alone, with its own code and words',
    async (_n, over, code, message) => {
      const r = await evaluate(quiet(over as Partial<Facts>));
      expect(r?.blockers).toHaveLength(1);
      expect(r?.blockers[0]).toMatchObject({ code, message });
      expect(r?.blockers[0].hint).toBeTruthy();
    },
  );

  it('adds up the name-keyed records across invoices, ledger and dispatch orders', async () => {
    const r = await evaluate(
      quiet({ invoices: 1, ledger: 2, dispatchByName: 3 }),
    );
    expect(r?.blockers[0].count).toBe(6);
  });

  it('compares the name AND every registration legal and trade name, normalised, without duplicates', async () => {
    const db = dbFor(
      quiet({
        name: '  Sterling   PUMPS ',
        registrations: [
          {
            id: 'G1',
            legalName: 'Sterling Pumps Pvt Ltd',
            tradeName: 'sterling pumps',
            updatedAt: new Date('2026-09-01'),
          },
          {
            id: 'G2',
            legalName: 'Sterling Pumps Pvt Ltd',
            tradeName: null,
            updatedAt: new Date('2026-09-02'),
          },
        ],
      }),
    );
    await CUSTOMER_DELETION_POLICY.evaluate(db, 'C1');
    expect([...new Set<string>(db.names[0])].sort()).toEqual([
      'sterling pumps',
      'sterling pumps pvt ltd',
    ]);
    expect(normalizeName('  A   b ')).toBe('a b');
  });

  it('does not look for documents by registration when it has none', async () => {
    const db = dbFor(quiet());
    await CUSTOMER_DELETION_POLICY.evaluate(db, 'C1');
    expect(db.quotation.count).not.toHaveBeenCalled();
    expect(db.salesOrder.count).not.toHaveBeenCalled();
  });

  it('lists every blocker and is null for a missing customer', async () => {
    const all = customerBlockers({
      opportunities: 1,
      documents: 1,
      dispatchOrders: 1,
      vendorLink: true,
      nameKeyed: 1,
      contentShares: 1,
    });
    expect(all.map((b) => b.code).sort()).toEqual(
      [...CUSTOMER_DELETION_POLICY.blockerCodes].sort(),
    );
    expect(await evaluate(quiet({ missing: true }))).toBeNull();
  });

  it('gives a new token when any fact it rests on changes', async () => {
    const base = (await evaluate(quiet()))?.version;
    expect((await evaluate(quiet()))?.version).toBe(base);
    const reg1 = [
      {
        id: 'G1',
        legalName: 'S',
        tradeName: null,
        updatedAt: new Date('2026-09-01'),
      },
    ];
    const withReg = (await evaluate(quiet({ registrations: reg1 })))?.version;
    expect(
      (await evaluate(quiet({ registrations: reg1, quotations: 1 })))?.version,
    ).not.toBe(withReg);
    expect(
      (
        await evaluate(
          quiet({
            registrations: [{ ...reg1[0], updatedAt: new Date('2026-09-09') }],
          }),
        )
      )?.version,
    ).not.toBe(withReg);
    for (const change of [
      { opportunities: 1 },
      { events: 3 },
      { invoices: 1 },
      { isVendor: true },
      { shares: 1 },
      { updatedAt: '2026-10-02T00:00:00.000Z' },
    ]) {
      expect(
        (await evaluate(quiet(change as Partial<Facts>)))?.version,
      ).not.toBe(base);
    }
  });
});

describe('customer restore: conflicts and writes', () => {
  const snap = () => ({
    schemaVersion: 1,
    customer: {
      id: 'C1',
      customerCode: 'CUST-000007',
      customerName: 'Sterling Pumps',
      panNumber: 'ABCDE1234F',
      email: null,
      phone: null,
      customerType: null,
      isActive: true,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
      isVendor: false,
      linkedVendorId: null,
      deactivatedAt: null,
      deactivatedById: null,
      deactivationReason: null,
    },
    gstRegistrations: [
      {
        id: 'G1',
        customerId: 'C1',
        gstin: '27ABCDE1234F1Z5',
        legalName: 'Sterling',
        tradeName: null,
        branchName: null,
        stateCode: '27',
        stateName: 'Maharashtra',
        addressLine1: 'x',
        addressLine2: null,
        city: 'Pune',
        pincode: '411001',
        isDefault: true,
        isActive: true,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    events: [
      {
        id: 'E1',
        customerId: 'C1',
        action: 'CUSTOMER_CREATED',
        fromStatus: null,
        toStatus: 'ACTIVE',
        remarks: null,
        changes: null,
        gstRegistrationId: null,
        opportunityId: 'O1',
        actorId: 'U1',
        occurredAt: '2026-09-01T00:00:00.000Z',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  });
  const db = (
    over: {
      exists?: boolean;
      codeTaken?: boolean;
      matches?: any[];
      gstins?: string[];
      users?: string[];
      opps?: number;
      vendor?: number;
      clash?: number;
    } = {},
  ) =>
    ({
      customer: {
        findUnique: jest.fn(async (a: any) =>
          a.where.customerCode
            ? over.codeTaken
              ? { customerName: 'Other' }
              : null
            : over.exists
              ? { id: 'C1' }
              : null,
        ),
      },
      $queryRaw: jest.fn(async () => over.matches ?? []),
      customerGSTRegistration: {
        findMany: jest.fn(async () =>
          (over.gstins ?? []).map((gstin) => ({ gstin })),
        ),
        count: jest.fn(async () => over.clash ?? 0),
      },
      customerEvent: { count: jest.fn(async () => 0) },
      user: {
        findMany: jest.fn(async (a: any) =>
          (over.users ?? ['U1'])
            .filter((id) => a.where.id.in.includes(id))
            .map((id) => ({ id })),
        ),
      },
      opportunity: { count: jest.fn(async () => over.opps ?? 1) },
      vendor: { count: jest.fn(async () => over.vendor ?? 1) },
    }) as any;
  const codes = async (over = {}, s: unknown = snap()) =>
    (
      await CUSTOMER_DELETION_POLICY.restoreEvaluate(db(over), s, {
        entityId: 'C1',
      })
    ).conflicts.map((c) => c.code);

  it('has no conflict when nothing changed, and says what it would put back', async () => {
    const r = await CUSTOMER_DELETION_POLICY.restoreEvaluate(db(), snap(), {
      entityId: 'C1',
    });
    expect(r.conflicts).toEqual([]);
    expect(r.restores).toEqual([
      { label: 'The customer record', count: 1 },
      { label: 'GST registrations', count: 1 },
      { label: 'History events', count: 1 },
    ]);
  });

  it.each([
    [
      'the identity exists',
      { exists: true },
      CUSTOMER_RESTORE_CONFLICT.ID_EXISTS,
    ],
    [
      'the customer code is used',
      { codeTaken: true },
      CUSTOMER_RESTORE_CONFLICT.CODE_TAKEN,
    ],
    [
      'another customer has the PAN now',
      {
        matches: [
          {
            customerName: 'Other',
            customerCode: 'CUST-000009',
            panMatch: true,
            nameMatch: false,
          },
        ],
      },
      CUSTOMER_RESTORE_CONFLICT.DUPLICATE_PAN,
    ],
    [
      'another customer has the name now',
      {
        matches: [
          {
            customerName: 'Sterling Pumps',
            customerCode: 'CUST-000009',
            panMatch: false,
            nameMatch: true,
          },
        ],
      },
      CUSTOMER_RESTORE_CONFLICT.DUPLICATE_NAME,
    ],
    [
      'its GSTIN is registered to another customer',
      { gstins: ['27ABCDE1234F1Z5'] },
      CUSTOMER_RESTORE_CONFLICT.GSTIN_TAKEN,
    ],
    [
      'a person in its history is gone',
      { users: [] },
      CUSTOMER_RESTORE_CONFLICT.USER_MISSING,
    ],
    [
      'an opportunity in its history is gone',
      { opps: 0 },
      CUSTOMER_RESTORE_CONFLICT.OPPORTUNITY_MISSING,
    ],
    [
      'a piece of its history exists',
      { clash: 1 },
      CUSTOMER_RESTORE_CONFLICT.CHILD_ID_EXISTS,
    ],
  ])('%s', async (_n, over, code) => {
    expect(await codes(over)).toEqual([code]);
  });

  it('a phone or e-mail match alone is not a conflict (it only warns for a new customer)', async () => {
    expect(
      await codes({
        matches: [
          {
            customerName: 'X',
            customerCode: 'C',
            panMatch: false,
            nameMatch: false,
            phoneMatch: true,
            emailMatch: true,
          },
        ],
      }),
    ).toEqual([]);
  });

  it('the vendor it was linked to must still exist', async () => {
    const s = snap();
    (s.customer as any).linkedVendorId = 'V1';
    expect(await codes({ vendor: 0 }, s)).toEqual([
      CUSTOMER_RESTORE_CONFLICT.VENDOR_MISSING,
    ]);
  });

  it.each([
    ['null', null],
    ['a purged marker', { purged: true }],
    [
      'a customer without a code',
      { customer: { id: 'C1', customerName: 'x' } },
    ],
  ])('an unreadable snapshot (%s) is a conflict', async (_n, s) => {
    expect(await codes({}, s)).toEqual([
      CUSTOMER_RESTORE_CONFLICT.SNAPSHOT_INVALID,
    ]);
  });

  it('writes the customer first, then registrations and events with original ids, then the restore event; a null JSON column is left out', async () => {
    const calls: Array<[string, any]> = [];
    const tx: any = {
      customer: {
        create: jest.fn(async (a: any) => calls.push(['customer', a])),
      },
      customerGSTRegistration: {
        createMany: jest.fn(async (a: any) => calls.push(['registrations', a])),
      },
      customerEvent: {
        createMany: jest.fn(async (a: any) => calls.push(['events', a])),
        create: jest.fn(async (a: any) => calls.push(['event', a])),
      },
    };
    const now = new Date('2026-10-05T00:00:00.000Z');
    await CUSTOMER_DELETION_POLICY.restore(tx, snap(), {
      recordId: 'R',
      actorId: 'U9',
      now,
    });

    expect(calls.map((c) => c[0])).toEqual([
      'customer',
      'registrations',
      'events',
      'event',
    ]);
    expect(calls[0][1].data).toMatchObject({
      id: 'C1',
      customerCode: 'CUST-000007',
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: now,
    });
    expect(calls[1][1].data[0]).toMatchObject({
      id: 'G1',
      gstin: '27ABCDE1234F1Z5',
      customerId: 'C1',
    });
    expect(calls[2][1].data[0]).not.toHaveProperty('changes');
    expect(calls[2][1].data[0]).toMatchObject({
      id: 'E1',
      opportunityId: 'O1',
    });
    expect(calls[3][1].data).toMatchObject({
      customerId: 'C1',
      action: 'CUSTOMER_RESTORED',
      actorId: 'U9',
      occurredAt: now,
    });
    expect(calls[3][1].data.remarks).toBe(
      'Customer restored from the Recycle Bin. It had been deleted earlier.',
    );
  });

  it("after a purge, scrubs the erased customer's name from the survivor's history: only the exact entries that named it, replaced by a neutral sentence", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    await CUSTOMER_DELETION_POLICY.redactSurvivorEvents(
      { customerEvent: { updateMany } } as any,
      { survivorId: 'S1', removedLabel: 'Sterling Pumps' },
    );

    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        customerId: 'S1',
        action: 'CUSTOMER_DUPLICATE_REMOVED',
        remarks:
          'Duplicate customer "Sterling Pumps" was moved to the Recycle Bin.',
      },
      data: {
        remarks:
          'A duplicate customer was moved to the Recycle Bin and has since been permanently erased.',
      },
    });
    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        customerId: 'S1',
        action: 'CUSTOMER_DUPLICATE_RESTORED',
        remarks:
          'Customer "Sterling Pumps", deleted earlier as a duplicate of this customer, was restored.',
      },
      data: {
        remarks:
          'A duplicate customer was moved to the Recycle Bin and has since been permanently erased.',
      },
    });
  });

  it('takes the customer-name lock before the duplicate checks', async () => {
    const tx: any = { $executeRaw: jest.fn(async () => 0) };
    await CUSTOMER_DELETION_POLICY.lockForRestore(tx, snap());
    expect(tx.$executeRaw).toHaveBeenCalled();
  });
});
