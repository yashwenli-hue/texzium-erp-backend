/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, @typescript-eslint/unbound-method -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { CustomerStatementsController } from './customer-statements.controller';
import { CustomerStatementsModule } from './customer-statements.module';
import { STATEMENT_TOO_LONG_MESSAGE } from './customer-statements.service';

// GET /customers/:id/statement through real HTTP: the real global JwtAuthGuard and JWT
// strategy, the credential-redaction interceptor, PermissionsGuard, ValidationPipe and
// service. The database is a synthetic, read-only double: it has no create, update or
// delete, so any write fails the test.

const A = '00000000-0000-4000-8000-00000000000a'; // Raj Traders
const B = '00000000-0000-4000-8000-00000000000b'; // also "Raj Traders" (another customer)
const INACTIVE = '00000000-0000-4000-8000-00000000000c';
const BUSY = '00000000-0000-4000-8000-00000000000d'; // more than 5,000 rows in any period
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';

const customers: Record<string, any> = {
  [A]: {
    id: A,
    customerCode: 'CUST-A',
    customerName: 'Raj Traders',
    isActive: true,
  },
  [B]: {
    id: B,
    customerCode: 'CUST-B',
    customerName: 'Raj Traders',
    isActive: true,
  },
  [INACTIVE]: {
    id: INACTIVE,
    customerCode: 'CUST-C',
    customerName: 'Closed Co',
    isActive: false,
  },
  [BUSY]: {
    id: BUSY,
    customerCode: 'CUST-D',
    customerName: 'Busy Co',
    isActive: true,
  },
};
const opportunities = [
  { id: 'oA', customerId: A },
  { id: 'oB', customerId: B },
  { id: 'oC', customerId: INACTIVE },
  { id: 'oD', customerId: BUSY },
  { id: 'oLegacy', customerId: null }, // looks like Raj Traders, not linked
];
const quotations = [
  { id: 'qA', opportunityId: 'oA' },
  { id: 'qB', opportunityId: 'oB' },
  { id: 'qC', opportunityId: 'oC' },
  { id: 'qD', opportunityId: 'oD' },
  { id: 'qL', opportunityId: 'oLegacy' },
];
const proformas = [{ id: 'pA', quotationId: 'qA' }];
const salesOrders = [
  { id: 'soA1', quotationId: 'qA', proformaInvoiceId: null },
  { id: 'soA2', quotationId: null, proformaInvoiceId: 'pA' }, // reached through its proforma
  { id: 'soB', quotationId: 'qB', proformaInvoiceId: null },
  { id: 'soC', quotationId: 'qC', proformaInvoiceId: null },
  { id: 'soD', quotationId: 'qD', proformaInvoiceId: null },
  { id: 'soL', quotationId: 'qL', proformaInvoiceId: null },
];
const invoices = [
  {
    id: 'iA1',
    salesOrderId: 'soA1',
    invoiceNumber: 'INV-A1',
    status: 'POSTED',
  },
  {
    id: 'iA2',
    salesOrderId: 'soA2',
    invoiceNumber: 'INV-A2',
    status: 'POSTED',
  },
  {
    id: 'iA3',
    salesOrderId: 'soA1',
    invoiceNumber: 'INV-A3',
    status: 'POSTED',
  }, // no ledger row
  { id: 'iA4', salesOrderId: 'soA1', invoiceNumber: null, status: 'DRAFT' }, // draft: not counted
  { id: 'iB', salesOrderId: 'soB', invoiceNumber: 'INV-B', status: 'POSTED' },
  { id: 'iC', salesOrderId: 'soC', invoiceNumber: 'INV-C', status: 'POSTED' },
  { id: 'iD', salesOrderId: 'soD', invoiceNumber: 'INV-D', status: 'POSTED' },
  { id: 'iL', salesOrderId: 'soL', invoiceNumber: 'INV-L', status: 'POSTED' },
];
const L = (
  id: string,
  inv: string,
  day: string,
  debit: number,
  credit: number,
  at: string,
  remarks: string,
) => ({
  id,
  customerName: 'Raj Traders', // the same name everywhere: must never matter
  salesInvoiceId: inv,
  entryDate: new Date(`${day}T00:00:00.000Z`),
  createdAt: new Date(at),
  debitAmount: debit,
  creditAmount: credit,
  balanceAmount: 424242, // stored balances are never used
  remarks,
});
const ledger = [
  L(
    'l1',
    'iA1',
    '2026-04-01',
    1000,
    0,
    '2026-04-01T10:00:00Z',
    'Sales invoice posted iA1',
  ),
  L(
    'l2',
    'iA1',
    '2026-04-15',
    0,
    400,
    '2026-04-15T10:00:00Z',
    'Payment received UTR1',
  ),
  L(
    'l4',
    'iA2',
    '2026-05-01',
    0,
    50,
    '2026-05-01T12:00:00Z',
    'Credit Note CN-1',
  ),
  L(
    'l3',
    'iA2',
    '2026-05-01',
    250.55,
    0,
    '2026-05-01T09:00:00Z',
    'Sales invoice posted iA2',
  ),
  L(
    'lB',
    'iB',
    '2026-04-10',
    7777,
    0,
    '2026-04-10T10:00:00Z',
    'Sales invoice posted iB',
  ),
  L(
    'lC',
    'iC',
    '2026-03-01',
    90,
    0,
    '2026-03-01T10:00:00Z',
    'Sales invoice posted iC',
  ),
  L(
    'lL',
    'iL',
    '2026-04-20',
    5555,
    0,
    '2026-04-20T10:00:00Z',
    'Sales invoice posted iL',
  ),
];

const inList = (value: any, cond: any) => !cond?.in || cond.in.includes(value);
const inRange = (d: Date, c: any) =>
  !c || ((!c.gte || d >= c.gte) && (!c.lt || d < c.lt));
const ledgerWhere = (where: any) =>
  ledger.filter(
    (r) =>
      inList(r.salesInvoiceId, where.salesInvoiceId) &&
      inRange(r.entryDate, where.entryDate),
  );
const pick = (row: any, select: any) =>
  select
    ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]))
    : row;

function token(permissions: string[]) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: 'u-1', email: 'u@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

describe('GET /customers/:id/statement', () => {
  let app: INestApplication;
  const db: any = {
    customer: {
      findUnique: jest.fn(async ({ where, select }: any) =>
        customers[where.id] ? pick(customers[where.id], select) : null,
      ),
    },
    opportunity: {
      findMany: jest.fn(async ({ where }: any) =>
        opportunities.filter((o) => o.customerId === where.customerId),
      ),
    },
    quotation: {
      findMany: jest.fn(async ({ where }: any) =>
        quotations.filter((q) => inList(q.opportunityId, where.opportunityId)),
      ),
    },
    proformaInvoice: {
      findMany: jest.fn(async ({ where }: any) =>
        proformas.filter((p) => inList(p.quotationId, where.quotationId)),
      ),
    },
    salesOrder: {
      findMany: jest.fn(async ({ where }: any) =>
        salesOrders.filter((o) =>
          where.OR.some(
            (c: any) =>
              (c.quotationId && c.quotationId.in.includes(o.quotationId)) ||
              (c.proformaInvoiceId &&
                c.proformaInvoiceId.in.includes(o.proformaInvoiceId)),
          ),
        ),
      ),
    },
    salesInvoice: {
      findMany: jest.fn(async ({ where, select }: any) =>
        invoices
          .filter((i) => inList(i.salesOrderId, where.salesOrderId))
          .map((i) => pick(i, select)),
      ),
    },
    customerLedger: {
      count: jest.fn(async ({ where }: any) =>
        where.salesInvoiceId.in.includes('iD')
          ? 5001
          : ledgerWhere(where).length,
      ),
      findMany: jest.fn(async ({ where, select, distinct }: any) => {
        let rows = ledgerWhere(where).map((r) => pick(r, select));
        if (distinct)
          rows = rows.filter(
            (r, i, all) =>
              all.findIndex((x) => x.salesInvoiceId === r.salesInvoiceId) === i,
          );
        return rows;
      }),
    },
    $queryRaw: jest.fn(async () => [{ id: 'oLegacy' }, { id: 'oOther' }]),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, CustomerStatementsModule],
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

  beforeEach(() => jest.clearAllMocks());

  const get = (
    url: string,
    permissions: string[] | null = ['collections.view'],
  ) => {
    const req = request(app.getHttpServer()).get(url);
    if (permissions) req.set('Authorization', `Bearer ${token(permissions)}`);
    return req;
  };

  it('declares collections.view and nothing else', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        CustomerStatementsController.prototype.statement,
      ),
    ).toEqual(['collections.view']);
  });

  describe('access', () => {
    it('401 without a token', async () => {
      expect((await get(`/customers/${A}/statement`, null)).status).toBe(401);
      expect(db.customer.findUnique).not.toHaveBeenCalled();
    });

    it('403 without collections.view, even with every customer permission', async () => {
      const res = await get(`/customers/${A}/statement`, [
        'customers.view',
        'customers.edit',
        'collections.record',
        'finance.report.view',
      ]);
      expect(res.status).toBe(403);
      expect(db.customer.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('the statement', () => {
    it("all time: only this customer's rows, by id, in date order with running balances", async () => {
      const res = await get(`/customers/${A}/statement`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        customer: {
          id: A,
          customerCode: 'CUST-A',
          customerName: 'Raj Traders',
          isActive: true,
        },
        period: { from: null, to: null },
        currency: 'INR',
        openingBalance: 0,
        totalDebits: 1250.55,
        totalCredits: 450,
        closingBalance: 800.55,
        coverage: {
          postedInvoicesWithoutLedgerEntries: 1,
          unlinkedLegacyMatches: 2,
        },
      });
      expect(
        res.body.entries.map((e: any) => [
          e.id,
          e.entryDate,
          e.invoiceNumber,
          e.debit,
          e.credit,
          e.runningBalance,
        ]),
      ).toEqual([
        ['l1', '2026-04-01', 'INV-A1', 1000, 0, 1000],
        ['l2', '2026-04-15', 'INV-A1', 0, 400, 600],
        ['l3', '2026-05-01', 'INV-A2', 250.55, 0, 850.55],
        ['l4', '2026-05-01', 'INV-A2', 0, 50, 800.55],
      ]);
      expect(res.body.entries[1].remarks).toBe('Payment received UTR1');
      expect(Object.keys(res.body.entries[0]).sort()).toEqual([
        'credit',
        'debit',
        'entryDate',
        'id',
        'invoiceNumber',
        'remarks',
        'runningBalance',
        'salesInvoiceId',
      ]);
      expect(JSON.stringify(res.body)).not.toContain('424242');
    });

    it('another customer with the same name sees only its own rows', async () => {
      const res = await get(`/customers/${B}/statement`);
      expect(res.body.entries.map((e: any) => e.id)).toEqual(['lB']);
      expect(res.body.closingBalance).toBe(7777);
    });

    it('rows of an opportunity not linked to the customer are never included, only counted', async () => {
      const res = await get(`/customers/${A}/statement`);
      expect(res.body.entries.map((e: any) => e.id)).not.toContain('lL');
      expect(res.body.coverage.unlinkedLegacyMatches).toBe(2);
    });

    it('never selects ledger rows by name', async () => {
      await get(`/customers/${A}/statement`);
      for (const [args] of [
        ...db.customerLedger.findMany.mock.calls,
        ...db.customerLedger.count.mock.calls,
      ]) {
        expect(JSON.stringify(args.where)).not.toContain('customerName');
        expect(args.where.salesInvoiceId.in.sort()).toEqual([
          'iA1',
          'iA2',
          'iA3',
          'iA4',
        ]);
      }
    });

    it('an inactive customer still has a statement', async () => {
      const res = await get(`/customers/${INACTIVE}/statement`);
      expect(res.status).toBe(200);
      expect(res.body.customer.isActive).toBe(false);
      expect(res.body.closingBalance).toBe(90);
    });

    it('a customer with no linked opportunity has an empty statement', async () => {
      db.opportunity.findMany.mockResolvedValueOnce([]);
      const res = await get(`/customers/${A}/statement`);
      expect(res.body).toMatchObject({
        entries: [],
        openingBalance: 0,
        closingBalance: 0,
      });
      expect(db.customerLedger.findMany).not.toHaveBeenCalled();
    });
  });

  describe('periods (whole days, both ends inclusive)', () => {
    it('opening balance is everything before the first day', async () => {
      const res = await get(
        `/customers/${A}/statement?from=2026-04-15&to=2026-05-01`,
      );
      expect(res.body).toMatchObject({
        period: { from: '2026-04-15', to: '2026-05-01' },
        openingBalance: 1000,
        totalDebits: 250.55,
        totalCredits: 450,
        closingBalance: 800.55,
      });
      expect(res.body.entries.map((e: any) => e.id)).toEqual([
        'l2',
        'l3',
        'l4',
      ]);
    });

    it('a day after a payment starts from the balance after it', async () => {
      const res = await get(`/customers/${A}/statement?from=2026-04-16`);
      expect(res.body.openingBalance).toBe(600);
      expect(res.body.entries.map((e: any) => e.id)).toEqual(['l3', 'l4']);
    });

    it('up to a day before the payment', async () => {
      const res = await get(`/customers/${A}/statement?to=2026-04-14`);
      expect(res.body.entries.map((e: any) => e.id)).toEqual(['l1']);
      expect(res.body.closingBalance).toBe(1000);
    });

    it('a single day includes all entries of that day', async () => {
      const res = await get(
        `/customers/${A}/statement?from=2026-05-01&to=2026-05-01`,
      );
      expect(res.body.entries.map((e: any) => e.id)).toEqual(['l3', 'l4']);
      expect(res.body.openingBalance).toBe(600);
    });

    it('a period with no entries keeps the balance', async () => {
      const res = await get(`/customers/${A}/statement?from=2026-06-01`);
      expect(res.body).toMatchObject({
        entries: [],
        openingBalance: 800.55,
        closingBalance: 800.55,
      });
    });
  });

  describe('refusals', () => {
    it.each([
      ['an impossible date', 'from=2026-02-30'],
      ['a date without leading zeros', 'from=2026-4-1'],
      ['a word', 'to=yesterday'],
      ['a timestamp', 'from=2026-04-01T00:00:00Z'],
      ['an unknown parameter', 'customerName=Raj%20Traders'],
    ])('400 for %s', async (_n, qs) => {
      expect((await get(`/customers/${A}/statement?${qs}`)).status).toBe(400);
      expect(db.customer.findUnique).not.toHaveBeenCalled();
    });

    it('400 when the start is after the end', async () => {
      const res = await get(
        `/customers/${A}/statement?from=2026-05-02&to=2026-05-01`,
      );
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        'The start date must not be after the end date.',
      );
    });

    it('400 for an id that is not a UUID', async () => {
      expect((await get('/customers/Raj%20Traders/statement')).status).toBe(
        400,
      );
    });

    it('404 for an unknown customer', async () => {
      const res = await get(`/customers/${UNKNOWN}/statement`);
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Customer not found.');
    });

    it('422 when the period has more than 5,000 entries', async () => {
      const res = await get(`/customers/${BUSY}/statement`);
      expect(res.status).toBe(422);
      expect(res.body.message).toBe(STATEMENT_TOO_LONG_MESSAGE);
      expect(db.customerLedger.findMany).not.toHaveBeenCalled();
    });
  });

  describe('GET /customers/:id/statement.pdf', () => {
    const pdf = (
      url: string,
      permissions: string[] | null = ['collections.view'],
    ) =>
      get(url, permissions)
        .buffer(true)
        .parse((res: any, cb: (e: Error | null, b: Buffer) => void) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });

    it('declares collections.view and nothing else', () => {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          CustomerStatementsController.prototype.statementPdf,
        ),
      ).toEqual(['collections.view']);
    });

    it('401 without a token, 403 without collections.view', async () => {
      expect((await pdf(`/customers/${A}/statement.pdf`, null)).status).toBe(
        401,
      );
      expect(
        (await pdf(`/customers/${A}/statement.pdf`, ['customers.view'])).status,
      ).toBe(403);
      expect(db.customer.findUnique).not.toHaveBeenCalled();
    });

    it('streams a PDF built in memory, as an attachment with safe headers', async () => {
      const res = await pdf(
        `/customers/${A}/statement.pdf?from=2026-04-15&to=2026-05-01`,
      );
      expect(res.status).toBe(200);
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        'attachment; filename="statement-CUST-A-2026-04-15-2026-05-01.pdf"',
      );
      expect(res.headers['content-length']).toBe(String(res.body.length));
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('names an all-time statement after today', async () => {
      const res = await pdf(`/customers/${B}/statement.pdf`);
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="statement-CUST-B-all-${new Date().toISOString().slice(0, 10)}.pdf"`,
      );
    });

    it('answers refusals as JSON, like the statement itself', async () => {
      expect((await get(`/customers/${UNKNOWN}/statement.pdf`)).status).toBe(
        404,
      );
      expect(
        (await get(`/customers/${A}/statement.pdf?from=2026-02-30`)).status,
      ).toBe(400);
      expect(
        (
          await get(
            `/customers/${A}/statement.pdf?from=2026-05-02&to=2026-05-01`,
          )
        ).status,
      ).toBe(400);
      expect((await get(`/customers/${BUSY}/statement.pdf`)).status).toBe(422);
    });
  });

  describe('the name-based routes are gone', () => {
    it.each([
      '/customer-statements/Raj%20Traders',
      '/statement-pdf/Raj%20Traders',
    ])('GET %s is a 404', async (url) => {
      expect((await get(url, ['collections.view'])).status).toBe(404);
    });
  });
});
