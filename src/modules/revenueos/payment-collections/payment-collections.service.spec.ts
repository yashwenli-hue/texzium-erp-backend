import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PaymentCollectionsService } from './payment-collections.service';
import { CreatePaymentCollectionDto } from './dto/create-payment-collection.dto';

// The command's decisions, with the database stubbed. What the database itself
// guarantees (locks, constraints, atomicity under concurrency) is proven against
// a real Postgres in the scratch-database run, not here.

const INVOICE = '523eddb0-27fc-4277-933e-f0ed25b66f97';
const AR = 'fb72c6f5-2c39-4a6f-aef1-6df7057f70bd';
const ACTOR = { id: 'user-1', fullName: 'Asha Admin' };

type Arg = Record<string, any> & {
  data: Record<string, unknown>;
  where: Record<string, unknown>;
};

interface Setup {
  receivables?: Array<Record<string, unknown>>;
  invoiceStatus?: string;
  invoiceCustomer?: string | null;
  duplicate?: boolean;
  lastLedgerBalance?: number | null;
  casCount?: number;
  createError?: unknown;
  actorExists?: boolean;
  invoiceExists?: boolean;
}

const receivable = (over: Record<string, unknown> = {}) => ({
  id: AR,
  salesInvoiceId: INVOICE,
  outstandingAmount: 324500,
  paidAmount: 100000,
  balanceAmount: 224500,
  paymentStatus: 'PARTIAL',
  ...over,
});

function build(setup: Setup = {}) {
  const log: string[] = [];
  const raw: string[] = [];

  const tx = {
    $executeRaw: jest.fn((strings: TemplateStringsArray) => {
      raw.push(strings.join('?').replace(/\s+/g, ' ').trim());
      return Promise.resolve(1);
    }),
    $queryRaw: jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?').replace(/\s+/g, ' ').trim();
      raw.push(sql);

      if (/FROM "AccountsReceivable"/.test(sql))
        return Promise.resolve(setup.receivables ?? [receivable()]);
      if (/FROM "SalesInvoice"/.test(sql)) {
        return Promise.resolve([
          {
            status: setup.invoiceStatus ?? 'POSTED',
            customerName:
              setup.invoiceCustomer === undefined
                ? 'Tata Projects'
                : setup.invoiceCustomer,
          },
        ]);
      }
      if (/FROM "PaymentCollection"/.test(sql))
        return Promise.resolve(setup.duplicate ? [{ id: 'pc-old' }] : []);

      return Promise.resolve([]);
    }),
    salesInvoice: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          setup.invoiceExists === false ? null : { id: INVOICE },
        ),
    },
    customerLedger: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          setup.lastLedgerBalance === null
            ? null
            : { balanceAmount: setup.lastLedgerBalance ?? 224500 },
        ),
      create: jest.fn((a: Arg) => {
        log.push('ledger');
        return Promise.resolve(a.data);
      }),
    },
    paymentCollection: {
      create: jest.fn((a: Arg) => {
        log.push('collection');
        if (setup.createError)
          return Promise.reject(asError(setup.createError));
        return Promise.resolve({
          id: 'pc-new',
          ...a.data,
          createdAt: new Date(),
        });
      }),
    },
    accountsReceivable: {
      updateMany: jest.fn((a: Arg) => {
        log.push('receivable');
        return Promise.resolve({ count: setup.casCount ?? 1, where: a.where });
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: AR }),
    },
    paymentCollectionEvent: {
      create: jest.fn((a: Arg) => {
        log.push('event');
        return Promise.resolve({ id: 'ev-1', ...a.data });
      }),
    },
  };

  const prisma = {
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue(setup.actorExists === false ? null : ACTOR),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    salesInvoice: tx.salesInvoice,
    accountsReceivable: { findMany: jest.fn() },
    paymentCollection: { findMany: jest.fn(), findUnique: jest.fn() },
    paymentCollectionEvent: { findMany: jest.fn() },
  };

  return {
    service: new PaymentCollectionsService(prisma as never),
    tx,
    prisma,
    log,
    raw,
  };
}

const dto = (
  over: Partial<CreatePaymentCollectionDto> = {},
): CreatePaymentCollectionDto => ({
  salesInvoiceId: INVOICE,
  paymentDate: '2026-10-01T00:00:00.000Z',
  amountReceived: 1000,
  paymentMode: 'BANK_TRANSFER',
  referenceNo: 'UTR-1',
  ...over,
});

const conflictOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ConflictException);
    return (e as ConflictException).getResponse() as {
      code: string;
      message: string;
      statusCode: number;
    };
  }
  throw new Error('expected a conflict');
};

const argOf = (mock: jest.Mock, call = 0) =>
  (mock.mock.calls as unknown[][])[call][0] as Arg;

const asError = (e: unknown): Error =>
  e instanceof Error ? e : new Error(String(e));

const nothingWritten = (log: string[]) => expect(log).toEqual([]);

describe('PaymentCollectionsService.create', () => {
  it('records a partial payment: collection, ledger credit, receivable and event, in one transaction', async () => {
    const { service, tx, prisma, log } = build();

    const out = await service.create(
      dto({ amountReceived: 24500.5, remarks: 'part' }),
      ACTOR.id,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['ledger', 'collection', 'receivable', 'event']);

    expect(argOf(tx.customerLedger.create).data).toMatchObject({
      customerName: 'Tata Projects',
      debitAmount: 0,
      creditAmount: 24500.5,
      balanceAmount: 199999.5,
      remarks: 'Payment received UTR-1',
    });
    expect(argOf(tx.paymentCollection.create).data).toMatchObject({
      accountsReceivableId: AR,
      amount: 24500.5,
      paymentMode: 'BANK_TRANSFER',
      referenceNumber: 'UTR-1',
      remarks: 'part',
      recordedById: ACTOR.id,
    });
    expect(argOf(tx.accountsReceivable.updateMany)).toEqual({
      where: {
        id: AR,
        paidAmount: 100000,
        balanceAmount: 224500,
        paymentStatus: 'PARTIAL',
      },
      data: {
        paidAmount: 124500.5,
        balanceAmount: 199999.5,
        paymentStatus: 'PARTIAL',
      },
    });
    expect(argOf(tx.paymentCollectionEvent.create).data).toMatchObject({
      action: 'PAYMENT_RECORDED',
      amount: 24500.5,
      balanceBefore: 224500,
      balanceAfter: 199999.5,
      fromStatus: 'PARTIAL',
      toStatus: 'PARTIAL',
      actorId: ACTOR.id,
    });
    expect(out.paymentRecord.recordedBy).toEqual(ACTOR);
    expect(out.event).toBeDefined();
  });

  it('closes the receivable (PAID) when the payment is exactly the balance', async () => {
    const { service, tx } = build();

    await service.create(dto({ amountReceived: 224500 }), ACTOR.id);

    expect(argOf(tx.accountsReceivable.updateMany).data).toEqual({
      paidAmount: 324500,
      balanceAmount: 0,
      paymentStatus: 'PAID',
    });
  });

  it('moves the figures by the payment, so a legacy receivable keeps its own drift', async () => {
    const { service, tx } = build({
      receivables: [
        receivable({
          outstandingAmount: 500,
          paidAmount: 0,
          balanceAmount: 400,
          paymentStatus: 'PENDING',
        }),
      ],
    });

    await service.create(dto({ amountReceived: 100 }), ACTOR.id);

    expect(argOf(tx.accountsReceivable.updateMany).data).toEqual({
      paidAmount: 100,
      balanceAmount: 300,
      paymentStatus: 'PARTIAL',
    });
  });

  it('compares in whole paise: a payment of 0.1 + 0.2 against a balance of 0.3 is exactly the balance', async () => {
    const { service, tx } = build({
      receivables: [
        receivable({
          outstandingAmount: 0.3,
          paidAmount: 0,
          balanceAmount: 0.3,
          paymentStatus: 'PENDING',
        }),
      ],
    });

    await service.create(dto({ amountReceived: 0.1 + 0.2 }), ACTOR.id);

    expect(argOf(tx.accountsReceivable.updateMany).data).toEqual({
      paidAmount: 0.3,
      balanceAmount: 0,
      paymentStatus: 'PAID',
    });
  });

  it('starts the ledger from zero for a customer with no entries', async () => {
    const { service, tx } = build({ lastLedgerBalance: null });

    await service.create(dto({ amountReceived: 1000 }), ACTOR.id);

    expect(argOf(tx.customerLedger.create).data.balanceAmount).toBe(-1000);
  });

  it('locks the receivable first, then reads the invoice shared, then serialises the ledger', async () => {
    const { service, raw } = build();

    await service.create(dto(), ACTOR.id);

    const order = raw.map((s) =>
      /FOR UPDATE/.test(s)
        ? 'receivable-lock'
        : /FOR SHARE/.test(s)
          ? 'invoice-share'
          : /pg_advisory_xact_lock/.test(s)
            ? 'ledger-advisory'
            : /lock_timeout/.test(s)
              ? 'timeout'
              : 'other',
    );

    expect(order.filter((o) => o !== 'other')).toEqual([
      'timeout',
      'receivable-lock',
      'invoice-share',
      'ledger-advisory',
    ]);
  });

  describe('refusals write nothing', () => {
    it('overpayment: 409 OVERPAYMENT, naming both amounts', async () => {
      const { service, log } = build();

      const body = await conflictOf(
        service.create(dto({ amountReceived: 224500.01 }), ACTOR.id),
      );

      expect(body).toMatchObject({ statusCode: 409, code: 'OVERPAYMENT' });
      expect(body.message).toBe(
        'The payment of ₹2,24,500.01 is more than the ₹2,24,500.00 outstanding on this invoice.',
      );
      nothingWritten(log);
    });

    it.each([
      ['PAID', 'RECEIVABLE_CLOSED', /already fully paid/],
      ['WRITTEN_OFF', 'RECEIVABLE_CLOSED', /written off/],
      ['SOMETHING_ELSE', 'RECEIVABLE_CLOSED', /Nothing is outstanding/],
    ])('a %s receivable', async (paymentStatus, code, message) => {
      const { service, log } = build({
        receivables: [receivable({ paymentStatus })],
      });

      const body = await conflictOf(service.create(dto(), ACTOR.id));

      expect(body.code).toBe(code);
      expect(body.message).toMatch(message);
      nothingWritten(log);
    });

    it('a receivable with no balance left, whatever its status says', async () => {
      const { service, log } = build({
        receivables: [
          receivable({ balanceAmount: 0, paymentStatus: 'PARTIAL' }),
        ],
      });

      expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
        'RECEIVABLE_CLOSED',
      );
      nothingWritten(log);
    });

    it('a negative legacy balance', async () => {
      const { service, log } = build({
        receivables: [
          receivable({ balanceAmount: -117700, paymentStatus: 'PARTIAL' }),
        ],
      });

      expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
        'RECEIVABLE_CLOSED',
      );
      nothingWritten(log);
    });

    it.each(['DRAFT', 'CANCELLED', ''])(
      'an invoice that is %p, not posted',
      async (invoiceStatus) => {
        const { service, log } = build({ invoiceStatus });

        expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
          'INVOICE_NOT_POSTED',
        );
        nothingWritten(log);
      },
    );

    it.each([null, '', '   '])(
      'an invoice with customer name %p',
      async (invoiceCustomer) => {
        const { service, log } = build({ invoiceCustomer });

        expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
          'LEDGER_CUSTOMER_MISSING',
        );
        nothingWritten(log);
      },
    );

    it('a reference already used on this receivable', async () => {
      const { service, log } = build({ duplicate: true });

      const body = await conflictOf(
        service.create(dto({ referenceNo: 'UTR-1' }), ACTOR.id),
      );

      expect(body.code).toBe('DUPLICATE_REFERENCE');
      expect(body.message).toContain('"UTR-1"');
      nothingWritten(log);
    });

    it('a receivable that changed under the lock: 409 RECEIVABLE_CHANGED (the transaction then rolls back)', async () => {
      const { service } = build({ casCount: 0 });

      expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
        'RECEIVABLE_CHANGED',
      );
    });

    it('two receivables for one invoice: 409 AMBIGUOUS_RECEIVABLE', async () => {
      const { service, log } = build({
        receivables: [receivable(), receivable({ id: 'ar-2' })],
      });

      expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
        'AMBIGUOUS_RECEIVABLE',
      );
      nothingWritten(log);
    });
  });

  it('refuses an amount under one paisa even if it got past the DTO, and writes nothing', async () => {
    const { service, prisma } = build();

    await expect(
      service.create(dto({ amountReceived: 1e-7 }), ACTOR.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('not found and sign-in', () => {
    it('an unknown invoice is a 404 that says so', async () => {
      const { service } = build({ receivables: [], invoiceExists: false });

      await expect(service.create(dto(), ACTOR.id)).rejects.toThrow(
        new NotFoundException('Sales invoice not found.'),
      );
    });

    it('an invoice without a receivable is a 404 that says so', async () => {
      const { service } = build({ receivables: [], invoiceExists: true });

      await expect(service.create(dto(), ACTOR.id)).rejects.toThrow(
        new NotFoundException(
          'This invoice has no receivable to collect against.',
        ),
      );
    });

    it('no signed-in user is refused before anything else happens', async () => {
      const { service, prisma } = build();

      await expect(service.create(dto(), undefined)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('a user that no longer exists is refused', async () => {
      const { service, prisma } = build({ actorExists: false });

      await expect(service.create(dto(), ACTOR.id)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('what the database reports', () => {
    const known = (code: string, meta?: Record<string, unknown>) =>
      new Prisma.PrismaClientKnownRequestError('x', {
        code,
        clientVersion: 'test',
        meta,
      });

    it('a unique-index violation is a duplicate reference (two requests raced past the check)', async () => {
      const { service } = build({ createError: known('P2002') });

      expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
        'DUPLICATE_REFERENCE',
      );
    });

    it.each([
      ['lock timeout', known('P2010', { code: '55P03' })],
      ['deadlock', known('P2010', { code: '40P01' })],
      ['serialization failure', known('P2010', { code: '40001' })],
      ['transaction conflict', known('P2034')],
    ])(
      '%s is "busy, try again" (409 RECEIVABLE_BUSY)',
      async (_label, createError) => {
        const { service } = build({ createError });

        expect((await conflictOf(service.create(dto(), ACTOR.id))).code).toBe(
          'RECEIVABLE_BUSY',
        );
      },
    );

    it('anything else is not disguised', async () => {
      const boom = new Error('connection lost');
      const { service } = build({ createError: boom });

      await expect(service.create(dto(), ACTOR.id)).rejects.toBe(boom);
    });
  });
});

describe('PaymentCollectionsService reads', () => {
  it('lists newest first, capped, with the filters applied', async () => {
    const { service, prisma } = build();

    prisma.paymentCollection.findMany.mockResolvedValue([]);

    await service.findAll({
      salesInvoiceId: INVOICE,
      from: '2026-09-01',
      to: '2026-09-30',
      limit: 20,
      offset: 40,
    });

    const arg = argOf(prisma.paymentCollection.findMany);

    expect(arg.where).toEqual({
      accountsReceivable: { salesInvoiceId: INVOICE },
      paymentDate: { gte: new Date('2026-09-01'), lte: new Date('2026-09-30') },
    });
    expect(arg.take).toBe(20);
    expect(arg.skip).toBe(40);
    expect((arg.orderBy as unknown[])[0]).toEqual({ paymentDate: 'desc' });
  });

  it('defaults the page to 100 rows', async () => {
    const { service, prisma } = build();

    prisma.paymentCollection.findMany.mockResolvedValue([]);
    await service.findAll({});

    expect(argOf(prisma.paymentCollection.findMany).take).toBe(100);
    expect(argOf(prisma.paymentCollection.findMany).skip).toBe(0);
  });

  it('a collection that does not exist is a 404', async () => {
    const { service, prisma } = build();

    prisma.paymentCollection.findUnique.mockResolvedValue(null);

    await expect(service.findOne('x')).rejects.toThrow(
      new NotFoundException('Payment collection not found.'),
    );
  });

  it('an invoice read says whether the invoice or its receivable is missing', async () => {
    const a = build({ invoiceExists: false });

    a.prisma.salesInvoice.findUnique.mockResolvedValue(null);
    await expect(a.service.findByInvoice(INVOICE)).rejects.toThrow(
      new NotFoundException('Sales invoice not found.'),
    );

    const b = build();

    b.prisma.salesInvoice.findUnique.mockResolvedValue({ id: INVOICE });
    b.prisma.accountsReceivable.findMany.mockResolvedValue([]);
    await expect(b.service.findByInvoice(INVOICE)).rejects.toThrow(
      new NotFoundException(
        'This invoice has no receivable to collect against.',
      ),
    );
  });

  it('an invoice read returns the receivable, its collections and its events together', async () => {
    const { service, prisma } = build();

    prisma.salesInvoice.findUnique.mockResolvedValue({
      id: INVOICE,
      customerName: 'Tata Projects',
    });
    prisma.accountsReceivable.findMany.mockResolvedValue([receivable()]);
    prisma.paymentCollection.findMany.mockResolvedValue([{ id: 'pc-1' }]);
    prisma.paymentCollectionEvent.findMany.mockResolvedValue([{ id: 'ev-1' }]);

    const out = await service.findByInvoice(INVOICE);

    expect(out.receivable).toMatchObject({
      id: AR,
      salesInvoice: { id: INVOICE },
    });
    expect(out.collections).toEqual([{ id: 'pc-1' }]);
    expect(out.events).toEqual([{ id: 'ev-1' }]);
  });
});
