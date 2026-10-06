/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- the pipe's output is loosely typed */
import { ValidationPipe } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

import { CreateAccountsCommercialApprovalDto } from '../accounts-commercial-approval/dto/create-accounts-commercial-approval.dto';
import { CreateSalesOrderAdvanceReceiptDto } from '../sales-order-advance-receipt/dto/create-sales-order-advance-receipt.dto';
import { VerifySalesOrderAdvanceReceiptDto } from '../sales-order-advance-receipt/dto/verify-sales-order-advance-receipt.dto';
import { CreateSalesOrderPaymentTermDto } from '../sales-order-payment-terms/dto/create-sales-order-payment-term.dto';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import {
  ADVANCE_RECEIPT_VERIFICATION_OUTCOMES,
  SALES_ORDER_PAYMENT_MODES,
  SALES_ORDER_PAYMENT_TYPES,
  SALES_ORDER_REFERENCE_MAX_LENGTH,
  SALES_ORDER_REMARKS_MAX_LENGTH,
} from './sales-order-values';

// The same options main.ts gives the application.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const run = (metatype: new () => object, body: unknown) =>
  pipe.transform(body, { type: 'body', metatype });

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';
const U4 = '44444444-4444-4444-8444-444444444444';

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('Sales Order DTO validation (the global ValidationPipe, as in main.ts)', () => {
  describe('CreateSalesOrderDto', () => {
    const valid = {
      proformaInvoiceId: U1,
      orderDate: '2026-10-06',
      totalAmount: 275000,
      inventoryItemId: U2,
      orderQty: 10,
      sellerGstId: U3,
      buyerGstId: U4,
    };

    it('accepts a valid order, including a date-only date and a fractional quantity', async () => {
      await expect(run(CreateSalesOrderDto, valid)).resolves.toMatchObject(
        valid,
      );
      await expect(
        run(CreateSalesOrderDto, { ...valid, orderQty: 2.5 }),
      ).resolves.toBeDefined();
      await expect(
        run(CreateSalesOrderDto, {
          ...valid,
          orderDate: '2026-10-06T00:00:00.000Z',
        }),
      ).resolves.toBeDefined();
    });

    it('accepts an order with no total (the total comes from the Proforma)', async () => {
      const { totalAmount: _omitted, ...withoutTotal } = valid;
      void _omitted;
      await expect(
        run(CreateSalesOrderDto, withoutTotal),
      ).resolves.toBeDefined();
    });

    it.each([
      ['a proforma id that is not a UUID', { proformaInvoiceId: 'p-1' }],
      ['a missing proforma id', { proformaInvoiceId: undefined }],
      ['a garbage date', { orderDate: 'not a date' }],
      ['an impossible calendar date', { orderDate: '2026-02-30' }],
      ['a numeric date', { orderDate: 1790000000000 }],
      ['a negative total', { totalAmount: -5 }],
      ['a zero total', { totalAmount: 0 }],
      ['a total sent as text', { totalAmount: '275000' }],
      ['a zero quantity', { orderQty: 0 }],
      ['a negative quantity', { orderQty: -1 }],
      ['an inventory item id that is not a UUID', { inventoryItemId: 'x' }],
      ['a seller GST id that is not a UUID', { sellerGstId: 'x' }],
      ['a buyer GST id that is not a UUID', { buyerGstId: 'x' }],
      ['a client-supplied status', { status: 'READY_FOR_DISPATCH_ORDER' }],
      ['a client-supplied tax type', { taxType: 'IGST' }],
      ['a client-supplied id', { id: U1 }],
    ])('rejects %s', async (_n, patch) => {
      await expect(
        run(CreateSalesOrderDto, { ...valid, ...patch }),
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('CreateSalesOrderPaymentTermDto', () => {
    const valid = {
      salesOrderId: U1,
      paymentType: 'PARTIAL_ADVANCE',
      advanceAmount: 100000,
      balanceAmount: 175000,
    };

    it('accepts every supported payment type and the optional fields', async () => {
      for (const paymentType of SALES_ORDER_PAYMENT_TYPES) {
        await expect(
          run(CreateSalesOrderPaymentTermDto, { ...valid, paymentType }),
        ).resolves.toBeDefined();
      }
      const full = await run(CreateSalesOrderPaymentTermDto, {
        ...valid,
        creditDays: 30,
        dueDate: '2026-11-05',
        remarks: '  Net 30  ',
      });
      expect(full.remarks).toBe('Net 30');
      expect(full.creditDays).toBe(30);
    });

    it('accepts zero advance or balance (credit and full-advance orders)', async () => {
      await expect(
        run(CreateSalesOrderPaymentTermDto, {
          ...valid,
          paymentType: 'CREDIT',
          advanceAmount: 0,
        }),
      ).resolves.toBeDefined();
      await expect(
        run(CreateSalesOrderPaymentTermDto, {
          ...valid,
          paymentType: 'FULL_ADVANCE',
          balanceAmount: 0,
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['an order id that is not a UUID', { salesOrderId: 'so-1' }],
      ['no order id', { salesOrderId: undefined }],
      ['an unknown payment type', { paymentType: 'BARTER' }],
      ['a lowercase payment type', { paymentType: 'credit' }],
      ['no payment type', { paymentType: undefined }],
      ['a negative advance', { advanceAmount: -1 }],
      ['a negative balance', { balanceAmount: -1 }],
      ['an advance sent as text', { advanceAmount: '5' }],
      ['a fractional credit period', { creditDays: 1.5 }],
      ['a negative credit period', { creditDays: -1 }],
      ['a garbage due date', { dueDate: 'next month' }],
      [
        'remarks over the limit',
        { remarks: 'x'.repeat(SALES_ORDER_REMARKS_MAX_LENGTH + 1) },
      ],
      ['an unknown property', { status: 'APPROVED' }],
    ])('rejects %s', async (_n, patch) => {
      await expect(
        run(CreateSalesOrderPaymentTermDto, { ...valid, ...patch }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects an empty body (every field was undecorated before and so rejected; now each is checked)', async () => {
      await expect(
        run(CreateSalesOrderPaymentTermDto, {}),
      ).rejects.toMatchObject({
        status: 400,
      });
    });
  });

  describe('CreateSalesOrderAdvanceReceiptDto', () => {
    const valid = {
      salesOrderId: U1,
      receiptDate: '2026-10-06',
      amountReceived: 100000,
      paymentMode: 'BANK_TRANSFER',
    };

    it('accepts every supported payment mode and the optional fields', async () => {
      for (const paymentMode of SALES_ORDER_PAYMENT_MODES) {
        await expect(
          run(CreateSalesOrderAdvanceReceiptDto, { ...valid, paymentMode }),
        ).resolves.toBeDefined();
      }
      const full = await run(CreateSalesOrderAdvanceReceiptDto, {
        ...valid,
        referenceNo: '  UTR123  ',
        remarks: '  Received in the HDFC account  ',
      });
      expect(full.referenceNo).toBe('UTR123');
      expect(full.remarks).toBe('Received in the HDFC account');
    });

    it.each([
      ['an order id that is not a UUID', { salesOrderId: 'so-1' }],
      ['a garbage receipt date', { receiptDate: 'yesterday' }],
      ['a zero amount', { amountReceived: 0 }],
      ['a negative amount', { amountReceived: -10 }],
      ['an amount sent as text', { amountReceived: '100000' }],
      ['an unknown payment mode', { paymentMode: 'CRYPTO' }],
      ['a lowercase payment mode', { paymentMode: 'upi' }],
      [
        'a reference over the limit',
        { referenceNo: 'x'.repeat(SALES_ORDER_REFERENCE_MAX_LENGTH + 1) },
      ],
      [
        'remarks over the limit',
        { remarks: 'x'.repeat(SALES_ORDER_REMARKS_MAX_LENGTH + 1) },
      ],
      [
        'a client-supplied verification status',
        { verificationStatus: 'VERIFIED' },
      ],
      ['a client-supplied verifier', { verifiedBy: 'someone' }],
    ])('rejects %s', async (_n, patch) => {
      await expect(
        run(CreateSalesOrderAdvanceReceiptDto, { ...valid, ...patch }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('VerifySalesOrderAdvanceReceiptDto', () => {
    it('accepts only VERIFIED and REJECTED', async () => {
      expect([...ADVANCE_RECEIPT_VERIFICATION_OUTCOMES]).toEqual([
        'VERIFIED',
        'REJECTED',
      ]);
      for (const verificationStatus of ADVANCE_RECEIPT_VERIFICATION_OUTCOMES) {
        await expect(
          run(VerifySalesOrderAdvanceReceiptDto, { verificationStatus }),
        ).resolves.toMatchObject({ verificationStatus });
      }
    });

    it.each([
      ['PENDING', 'PENDING'],
      ['UNDER_REVIEW', 'UNDER_REVIEW'],
      ['an unknown state', 'APPROVED'],
      ['lowercase', 'verified'],
      ['title case', 'Verified'],
      ['empty text', ''],
      ['a number', 1],
      ['null', null],
      ['a list', ['VERIFIED']],
    ])(
      'rejects a verification status of %s',
      async (_n, verificationStatus) => {
        await expect(
          run(VerifySalesOrderAdvanceReceiptDto, { verificationStatus }),
        ).rejects.toMatchObject({ status: 400 });
      },
    );

    it('rejects a missing verification status and an empty body', async () => {
      await expect(
        run(VerifySalesOrderAdvanceReceiptDto, {}),
      ).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        run(VerifySalesOrderAdvanceReceiptDto, { remarks: 'ok' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('takes optional remarks, trimmed, with a length limit', async () => {
      const ok = await run(VerifySalesOrderAdvanceReceiptDto, {
        verificationStatus: 'REJECTED',
        remarks: '  Amount does not match the bank statement  ',
      });
      expect(ok.remarks).toBe('Amount does not match the bank statement');
      await expect(
        run(VerifySalesOrderAdvanceReceiptDto, {
          verificationStatus: 'REJECTED',
          remarks: 'x'.repeat(SALES_ORDER_REMARKS_MAX_LENGTH + 1),
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it.each([
      ['a client-supplied verified time', { verifiedAt: '2026-10-06' }],
      ['a client-supplied actor id', { actorId: U1 }],
      [
        'a client-supplied order status',
        { status: 'PENDING_ACCOUNTS_APPROVAL' },
      ],
    ])('rejects %s', async (_n, extra) => {
      await expect(
        run(VerifySalesOrderAdvanceReceiptDto, {
          verificationStatus: 'VERIFIED',
          ...extra,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a client-named verifier: the actor is the signed-in user', async () => {
      await expect(
        run(VerifySalesOrderAdvanceReceiptDto, {
          verificationStatus: 'VERIFIED',
          verifiedBy: 'Accounts Manager',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('CreateAccountsCommercialApprovalDto', () => {
    const valid = { salesOrderId: U1 };

    it('accepts a valid approval with optional trimmed remarks', async () => {
      const ok = await run(CreateAccountsCommercialApprovalDto, {
        ...valid,
        remarks: '  Terms confirmed  ',
      });
      expect(ok.remarks).toBe('Terms confirmed');
    });

    it.each([
      ['an order id that is not a UUID', { salesOrderId: 'so-1' }],
      ['no order id', { salesOrderId: undefined }],
      ['a client-named approver', { approvedBy: 'Accounts Manager' }],
      [
        'remarks over the limit',
        { remarks: 'x'.repeat(SALES_ORDER_REMARKS_MAX_LENGTH + 1) },
      ],
      ['a client-supplied status', { status: 'APPROVED' }],
      ['a client-supplied actor id', { actorId: U1 }],
    ])('rejects %s', async (_n, patch) => {
      await expect(
        run(CreateAccountsCommercialApprovalDto, { ...valid, ...patch }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('values stay in step with the Prisma schema', () => {
    const enumValues = (name: string) => {
      const block = read('prisma/schema.prisma').match(
        new RegExp(`enum ${name} \\{([^}]*)\\}`),
      );
      expect(block).not.toBeNull();
      return block![1]
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    };

    it('payment types equal the PaymentType enum', () => {
      expect([...SALES_ORDER_PAYMENT_TYPES]).toEqual(enumValues('PaymentType'));
    });

    it('payment modes equal the PaymentMode enum', () => {
      expect([...SALES_ORDER_PAYMENT_MODES]).toEqual(enumValues('PaymentMode'));
    });

    it('verification outcomes are members of the PaymentVerificationStatus enum', () => {
      const all = enumValues('PaymentVerificationStatus');
      for (const outcome of ADVANCE_RECEIPT_VERIFICATION_OUTCOMES) {
        expect(all).toContain(outcome);
      }
    });
  });

  describe('the new SalesOrderEvent migration and permission SQL are additive', () => {
    const statements = (file: string) =>
      read(file)
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');

    it('the event migration only creates the new table, its indexes and its foreign keys', () => {
      const sql = statements(
        'prisma/manual-migrations/20261006_crm_sales_order_event.sql',
      );
      expect(sql).not.toMatch(
        /\b(DROP|TRUNCATE|INSERT|RENAME)\b|(?<!ON )\b(DELETE|UPDATE)\b/i,
      );
      // (ON DELETE / ON UPDATE inside a foreign key are the only DELETE/UPDATE words.)
      // Every ALTER TABLE targets the new table only.
      const alters = sql.match(/ALTER TABLE\s+"[A-Za-z]+"/gi) ?? [];
      expect(alters.length).toBeGreaterThan(0);
      for (const a of alters) expect(a).toContain('"SalesOrderEvent"');
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "SalesOrderEvent"/);
      expect(sql).toMatch(/ON DELETE SET NULL/); // history survives a deleted account
    });

    it('the permission SQL defines exactly the approved codes and grants only SUPER_ADMIN', () => {
      const sql = statements(
        'prisma/manual-migrations/20261006_crm_sales_order_permissions.sql',
      );
      const codes = [...sql.matchAll(/\('(salesorders\.[a-z.]+)',/g)].map(
        (m) => m[1],
      );
      expect(codes.sort()).toEqual(
        [
          'salesorders.view',
          'salesorders.create',
          'salesorders.paymentterms.view',
          'salesorders.paymentterms.create',
          'salesorders.advancereceipts.view',
          'salesorders.advancereceipts.create',
          'salesorders.advancereceipts.verify',
          'salesorders.commercialapproval.view',
          'salesorders.commercialapproval.approve',
        ].sort(),
      );
      expect(sql).toMatch(/r\."name" = 'SUPER_ADMIN'/);
      expect(sql).toMatch(/ON CONFLICT \("code"\) DO NOTHING/);
      expect(sql).toMatch(
        /ON CONFLICT \("roleId", "permissionId"\) DO NOTHING/,
      );
      expect(sql).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i);
    });
  });
});
