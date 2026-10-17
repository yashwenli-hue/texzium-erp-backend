/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/require-await, @typescript-eslint/unbound-method -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { ReceiptVouchersController } from './receipt-vouchers.controller';
import { ReceiptVouchersModule } from './receipt-vouchers.module';
import { RecordScopeGuard } from '../../revenueos/record-scope/record-scope.guard';

// The record scope of these routes is tested on a real database (record-visibility).
const SCOPE_TESTED_ELSEWHERE = { canActivate: () => true };

const PAY = '00000000-0000-4000-8000-000000000001';
const PAY_OLD = '00000000-0000-4000-8000-000000000002'; // already has a legacy RCPT- receipt
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff';
const INVOICE = '00000000-0000-4000-8000-0000000000a1';

function token(permissions: string[]) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: 'u-1', email: 'u@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

describe('/receipt-vouchers', () => {
  let app: INestApplication;
  let receipts: any[];
  let counter: number;
  const payments: Record<string, any> = {
    [PAY]: {
      id: PAY,
      paymentDate: new Date('2026-10-10T00:00:00.000Z'),
      amount: 123456,
      paymentMode: 'BANK_TRANSFER',
      referenceNumber: 'UTR-1',
    },
    [PAY_OLD]: {
      id: PAY_OLD,
      paymentDate: new Date('2026-06-30T00:00:00.000Z'),
      amount: 1000,
      paymentMode: 'CASH',
      referenceNumber: null,
    },
  };
  const raw: string[] = [];

  const db: any = {
    $transaction: jest.fn(async (fn: any) => fn(db)),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
      const sql = strings.join('?');
      raw.push(sql);
      if (sql.includes('receipt-voucher:lock-payment'))
        return payments[v[0]] ? [{ id: v[0] }] : [];
      if (sql.includes('document-number:allocate')) {
        counter += 1;
        return [{ lastNumber: counter }];
      }
      throw new Error(`unexpected raw query ${sql}`);
    }),
    paymentCollection: {
      findUniqueOrThrow: jest.fn(async ({ where }: any) => payments[where.id]),
    },
    receiptVoucher: {
      findUnique: jest.fn(
        async ({ where }: any) =>
          receipts.find(
            (r) => r.paymentCollectionId === where.paymentCollectionId,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `r${receipts.length + 1}`, ...data };
        receipts.push(row);
        return row;
      }),
      findMany: jest.fn(async () => receipts),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, AuthModule, ReceiptVouchersModule],
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

  beforeEach(() => {
    jest.clearAllMocks();
    raw.length = 0;
    counter = 0;
    receipts = [
      {
        id: 'r-old',
        receiptNumber: 'RCPT-263459',
        paymentCollectionId: PAY_OLD,
      },
    ];
  });

  const post = (id: string, permissions: string[] | null) => {
    const req = request(app.getHttpServer()).post(
      `/receipt-vouchers/${id}/generate`,
    );
    if (permissions) req.set('Authorization', `Bearer ${token(permissions)}`);
    return req;
  };

  it('declares collections.record to generate and collections.view to read', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ReceiptVouchersController.prototype.generate,
      ),
    ).toEqual(['collections.record']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ReceiptVouchersController.prototype.list,
      ),
    ).toEqual(['collections.view']);
  });

  it('refuses a request without a token (401) and without collections.record (403), writing nothing', async () => {
    await post(PAY, null).expect(401);
    await post(PAY, ['collections.view']).expect(403);
    expect(db.receiptVoucher.create).not.toHaveBeenCalled();
    expect(raw).toHaveLength(0);
  });

  it('a malformed id is 400 and an unknown payment is 404, with no number taken', async () => {
    await post('not-a-uuid', ['collections.record']).expect(400);
    const res = await post(UNKNOWN, ['collections.record']).expect(404);
    expect(res.body.message).toBe('Payment collection not found.');
    expect(raw.some((s) => s.includes('document-number:allocate'))).toBe(false);
  });

  it('creates one receipt with the next company receipt number, copying the payment as recorded', async () => {
    const res = await post(PAY, ['collections.record']).expect(201);
    expect(res.body).toMatchObject({
      receiptNumber: 'RC/26-27/00001',
      paymentCollectionId: PAY,
      amountReceived: 123456,
      paymentMode: 'BANK_TRANSFER',
      referenceNo: 'UTR-1',
      receiptDate: '2026-10-10T00:00:00.000Z',
    });
    // the payment is locked before anything is decided
    expect(raw[0]).toContain('FOR UPDATE');
  });

  it('asking again returns the same receipt: no second receipt and no second number', async () => {
    const first = await post(PAY, ['collections.record']).expect(201);
    const again = await post(PAY, ['collections.record']).expect(201);
    expect(again.body).toEqual(first.body);
    expect(db.receiptVoucher.create).toHaveBeenCalledTimes(1);
    expect(counter).toBe(1);
  });

  it('a payment that already has a legacy receipt keeps it; nothing is renumbered', async () => {
    const res = await post(PAY_OLD, ['collections.record']).expect(201);
    expect(res.body.receiptNumber).toBe('RCPT-263459');
    expect(db.receiptVoucher.create).not.toHaveBeenCalled();
    expect(counter).toBe(0);
  });

  it("lists an invoice's receipts with collections.view; refuses without it; validates the invoice id", async () => {
    const auth = (p: string[]) => `Bearer ${token(p)}`;
    await request(app.getHttpServer())
      .get(`/receipt-vouchers?salesInvoiceId=${INVOICE}`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/receipt-vouchers?salesInvoiceId=${INVOICE}`)
      .set('Authorization', auth(['collections.record']))
      .expect(403);
    await request(app.getHttpServer())
      .get('/receipt-vouchers?salesInvoiceId=nope')
      .set('Authorization', auth(['collections.view']))
      .expect(400);
    const ok = await request(app.getHttpServer())
      .get(`/receipt-vouchers?salesInvoiceId=${INVOICE}`)
      .set('Authorization', auth(['collections.view']))
      .expect(200);
    expect(ok.body).toHaveLength(1);
    expect(db.receiptVoucher.findMany.mock.calls[0][0].where).toEqual({
      paymentCollection: { accountsReceivable: { salesInvoiceId: INVOICE } },
    });
  });
});
