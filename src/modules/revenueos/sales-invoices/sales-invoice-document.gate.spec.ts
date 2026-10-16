/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import {
  collapse,
  pdfPageTexts,
} from '../../../core/documents/pdf-text.helper-spec';
import { SalesInvoicesModule } from './sales-invoices.module';
import { RecordScopeGuard } from '../record-scope/record-scope.guard';

// Who may see which record is tested on its own (record-scope.spec.ts and the
// integration tests); here every caller may see every record.
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OK = uid(1); // numbered, posted, lines with HSN; placeholder IRN and e-way bill stored
const LEGACY = uid(2); // issued before numbering
const NO_LINES = uid(3); // numbered, but no priced lines
const NO_BUYER = uid(4); // numbered, but its order has no buyer registration
const UNKNOWN = uid(99);

function token(permissions: string[]) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: 'u-1', email: 'u@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

const line = {
  lineNumber: 1,
  description: 'Industrial pump',
  hsnCode: '84137090',
  quantity: 4,
  rate: 25000,
  taxableAmount: 100000,
  gstRate: 18,
  cgstAmount: 0,
  sgstAmount: 0,
  igstAmount: 18000,
  gstAmount: 18000,
  totalAmount: 118000,
};
const invoice = (id: string, over: object = {}) => ({
  id,
  salesOrderId: id === NO_BUYER ? 'so-nobuyer' : 'so-1',
  invoiceNumber: 'SI24/26-27/00001',
  invoiceDate: new Date('2026-10-12T00:00:00Z'),
  status: 'POSTED',
  taxableAmount: 100000,
  gstAmount: 18000,
  cgstAmount: 0,
  sgstAmount: 0,
  igstAmount: 18000,
  totalAmount: 118000,
  remarks: null,
  irnNumber: 'IRN-PLACEHOLDER-7F3A',
  ewayBillNumber: 'EWB-PLACEHOLDER-991',
  SalesInvoiceItem: [line],
  ...over,
});
const invoices: Record<string, any> = {
  [OK]: invoice(OK),
  [LEGACY]: invoice(LEGACY, {
    invoiceNumber: null,
    SalesInvoiceItem: [
      {
        ...line,
        lineNumber: null,
        description: null,
        hsnCode: null,
        gstRate: null,
      },
    ],
  }),
  [NO_LINES]: invoice(NO_LINES, { SalesInvoiceItem: [] }),
  [NO_BUYER]: invoice(NO_BUYER),
};

// Every route goes through the real JWT and permission guards. The database
// double only answers reads.
describe('the tax-invoice PDF gate (GET /sales-invoices/:id/document.pdf)', () => {
  let app: INestApplication;
  const order = (buyer: boolean) => ({
    salesOrderCode: null,
    quotationId: 'q-1',
    proformaInvoiceId: null,
    sellerGstId: 'reg-24',
    buyerGstId: buyer ? 'buyer-27' : null,
    taxType: 'IGST',
    placeOfSupply: 'Maharashtra',
  });
  const db: any = {
    salesInvoice: {
      findMany: jest.fn(async () => Object.values(invoices)),
      findUnique: jest.fn(async ({ where }: any) => invoices[where.id] ?? null),
    },
    salesOrder: {
      findUnique: jest.fn(async ({ where }: any) =>
        order(where.id !== 'so-nobuyer'),
      ),
    },
    proformaInvoice: { findUnique: jest.fn(async () => null) },
    quotation: {
      findUnique: jest.fn(async () => ({
        quotationCode: 'QT24/26-27/00001',
        opportunityId: 'opp-1',
        sellerGstId: 'reg-24',
        buyerGstId: null,
        taxType: 'IGST',
        placeOfSupply: 'Maharashtra',
      })),
    },
    opportunity: { findUnique: jest.fn(async () => ({ customerId: 'c-1' })) },
    customer: {
      findUnique: jest.fn(async () => ({
        id: 'c-1',
        customerName: 'Raj Traders',
        customerCode: 'CUST001',
      })),
    },
    customerGSTRegistration: {
      findUnique: jest.fn(async () => ({
        id: 'buyer-27',
        customerId: 'c-1',
        gstin: '27AAAPL1234C1ZV',
        legalName: 'Raj Traders Private Limited',
        addressLine1: '12 MG Road',
        addressLine2: null,
        city: 'Pune',
        pincode: '411001',
        stateCode: '27',
        stateName: 'Maharashtra',
      })),
    },
    companyGSTRegistration: {
      findUnique: jest.fn(async () => ({
        id: 'reg-24',
        companyId: 'co-1',
        gstin: '24AAACT1234A1Z5',
        legalName: 'Texzium Industries Private Limited',
        tradeName: null,
        addressLine1: 'Plot 7, GIDC',
        addressLine2: null,
        city: 'Ahmedabad',
        pincode: '382445',
        stateCode: '24',
        stateName: 'Gujarat',
      })),
    },
    company: {
      findUnique: jest.fn(async () => ({
        id: 'co-1',
        companyName: 'Texzium Industries Private Limited',
        panNumber: 'AAACT1234A',
      })),
    },
    companyDocumentProfile: { findUnique: jest.fn(async () => null) },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, SalesInvoicesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideGuard(RecordScopeGuard)
      .useValue(SCOPE_TESTED_ELSEWHERE)
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

  const BOTH = ['invoices.view', 'invoices.document.view'];
  const pdf = (id: string, permissions: string[] | null) => {
    const req = request(app.getHttpServer())
      .get(`/sales-invoices/${id}/document.pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    if (permissions) req.set('Authorization', `Bearer ${token(permissions)}`);
    return req;
  };
  const json = (b: Buffer) => JSON.parse(b.toString());

  it('401 without a token; nothing is read', async () => {
    expect((await pdf(OK, null)).status).toBe(401);
    expect(db.salesInvoice.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    [
      'invoices.view only (what SUPER_ADMIN holds after activation)',
      ['invoices.view'],
    ],
    ['invoices.document.view only', ['invoices.document.view']],
    [
      'every other invoice and document permission',
      [
        'invoices.view',
        'invoices.create',
        'quotations.view',
        'proformas.view',
        'collections.view',
        'documents.view',
        'documents.profile.manage',
      ],
    ],
  ])('403 with %s; nothing is read', async (_n, permissions) => {
    expect((await pdf(OK, permissions)).status).toBe(403);
    expect(db.salesInvoice.findUnique).not.toHaveBeenCalled();
  });

  it('with both permissions: the PDF, as an attachment with safe headers, without the stored placeholder IRN or e-way bill', async () => {
    const res = await pdf(OK, BOTH);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="invoice-SI24_26-27_00001.pdf"',
    );
    const text = collapse(pdfPageTexts(res.body as Buffer).join(' '));
    expect(text).toContain('Tax Invoice');
    expect(text).toContain('Invoice no. SI24/26-27/00001');
    expect(text).toContain('GSTIN 27AAAPL1234C1ZV');
    expect(text).not.toMatch(/IRN|PLACEHOLDER|EWB|e-way/i);
    expect((res.body as Buffer).toString('latin1')).not.toMatch(/PLACEHOLDER/);
  });

  it.each([
    [LEGACY, /issued before invoices were numbered/],
    [NO_LINES, /lines do not carry a description, HSN and GST rate/],
    [NO_BUYER, /no customer with a buyer GST registration/],
  ])(
    'even with both permissions, an invoice missing what a tax invoice must carry is refused (409, with the reason): %s',
    async (id, reason) => {
      const res = await pdf(id, BOTH);
      expect(res.status).toBe(409);
      expect(json(res.body as Buffer).message).toMatch(reason);
    },
  );

  it('an unknown invoice is 404 and a malformed id 400', async () => {
    expect((await pdf(UNKNOWN, BOTH)).status).toBe(404);
    expect((await pdf('not-a-uuid', BOTH)).status).toBe(400);
  });

  it('reading invoices is unchanged: the list needs invoices.view only', async () => {
    const res = await request(app.getHttpServer())
      .get('/sales-invoices')
      .set('Authorization', `Bearer ${token(['invoices.view'])}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
  });
});
