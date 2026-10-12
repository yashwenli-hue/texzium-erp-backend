/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await, @typescript-eslint/unbound-method -- test doubles are intentionally loosely typed */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AuthModule } from '../../../core/auth/auth.module';
import { DatabaseModule } from '../../../core/database/database.module';
import { PrismaService } from '../../../core/database/prisma.service';
import { PERMISSIONS_KEY } from '../../../core/decorators/permissions.decorator';
import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesModule } from './sales-invoices.module';
import { SalesInvoiceItemsController } from '../sales-invoice-items/sales-invoice-items.controller';
import { SalesInvoiceItemsModule } from '../sales-invoice-items/sales-invoice-items.module';

function token(permissions: string[]) {
  return new JwtService({
    secret: process.env.JWT_SECRET || 'texzium-secret',
  }).sign(
    { sub: 'u-1', email: 'u@example.invalid', role: 'TEST', permissions },
    { expiresIn: '1h' },
  );
}

// Every route is reached through the real JWT and permission guards; the
// database is a double that fails the test if anything writes to it.
describe('sales invoice permissions', () => {
  let app: INestApplication;
  const db: any = {
    salesInvoice: { findMany: jest.fn(async () => []) },
    dispatchOrder: {
      findUnique: jest.fn(async () => {
        throw new Error('must not be reached');
      }),
    },
    salesInvoiceItem: {
      create: jest.fn(async () => {
        throw new Error('must not be reached');
      }),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        AuthModule,
        SalesInvoicesModule,
        SalesInvoiceItemsModule,
      ],
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

  const auth = (p: string[]) => `Bearer ${token(p)}`;
  const invoiceBody = {
    salesOrderId: 'so-1',
    dispatchOrderId: 'do-1',
    invoiceDate: '2026-10-07',
  };

  it('declares invoices.view to read, invoices.create to issue and to add items', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        SalesInvoicesController.prototype.findAll,
      ),
    ).toEqual(['invoices.view']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        SalesInvoicesController.prototype.create,
      ),
    ).toEqual(['invoices.create']);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        SalesInvoiceItemsController.prototype.create,
      ),
    ).toEqual(['invoices.create']);
  });

  it('GET /sales-invoices: 401 without a token, 403 without invoices.view, 200 with it', async () => {
    const server = app.getHttpServer();
    await request(server).get('/sales-invoices').expect(401);
    await request(server)
      .get('/sales-invoices')
      .set('Authorization', auth(['invoices.create', 'collections.view']))
      .expect(403);
    await request(server)
      .get('/sales-invoices')
      .set('Authorization', auth(['invoices.view']))
      .expect(200);
    expect(db.salesInvoice.findMany).toHaveBeenCalledTimes(1);
  });

  it('POST /sales-invoices: 401 without a token, 403 with only invoices.view; nothing is read or written', async () => {
    const server = app.getHttpServer();
    await request(server).post('/sales-invoices').send(invoiceBody).expect(401);
    await request(server)
      .post('/sales-invoices')
      .set('Authorization', auth(['invoices.view']))
      .send(invoiceBody)
      .expect(403);
    expect(db.dispatchOrder.findUnique).not.toHaveBeenCalled();
  });

  it('POST /sales-invoice-items: 401 without a token, 403 without invoices.create; nothing is written', async () => {
    const server = app.getHttpServer();
    const item = {
      salesInvoiceId: 'si-1',
      productId: 'p',
      quantity: 1,
      rate: 1,
      taxableAmount: 1,
      gstAmount: 0,
      totalAmount: 1,
    };
    await request(server).post('/sales-invoice-items').send(item).expect(401);
    await request(server)
      .post('/sales-invoice-items')
      .set('Authorization', auth(['invoices.view']))
      .send(item)
      .expect(403);
    expect(db.salesInvoiceItem.create).not.toHaveBeenCalled();
  });
});
