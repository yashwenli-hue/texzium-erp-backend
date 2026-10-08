import { ValidationPipe, BadRequestException } from '@nestjs/common';

import { CreatePaymentCollectionDto } from './dto/create-payment-collection.dto';
import { ListPaymentCollectionsQueryDto } from './dto/list-payment-collections-query.dto';

// The same options main.ts gives the application's global pipe.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const INVOICE = '523eddb0-27fc-4277-933e-f0ed25b66f97';
const valid = {
  salesInvoiceId: INVOICE,
  paymentDate: '2026-10-01T00:00:00.000Z',
  amountReceived: 1500.5,
  paymentMode: 'Bank Transfer',
  referenceNo: ' UTR-1 ',
};

const run = <T>(type: new () => T, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: type });

const messages = async (value: unknown): Promise<string> => {
  try {
    await run(CreatePaymentCollectionDto, value);
    return '';
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return JSON.stringify((e as BadRequestException).getResponse());
  }
};

describe('CreatePaymentCollectionDto', () => {
  it('accepts a valid payment and normalises mode and reference', async () => {
    const dto = (await run(
      CreatePaymentCollectionDto,
      valid,
    )) as CreatePaymentCollectionDto;

    expect(dto.paymentMode).toBe('BANK_TRANSFER');
    expect(dto.referenceNo).toBe('UTR-1');
    expect(dto.amountReceived).toBe(1500.5);
    expect(dto.remarks).toBeUndefined();
  });

  it('keeps optional remarks, trimmed, and treats blank remarks as absent', async () => {
    expect(
      (
        (await run(CreatePaymentCollectionDto, {
          ...valid,
          remarks: '  part payment ',
        })) as CreatePaymentCollectionDto
      ).remarks,
    ).toBe('part payment');
    expect(
      (
        (await run(CreatePaymentCollectionDto, {
          ...valid,
          remarks: '   ',
        })) as CreatePaymentCollectionDto
      ).remarks,
    ).toBeUndefined();
  });

  it.each([
    ['zero', 0],
    ['less than one paisa', 0.001],
    ['one ten-millionth, in exponent form', 1e-7],
    ['negative', -5],
    ['three decimals', 10.005],
    ['text', '100'],
    ['NaN', NaN],
    ['too large', 1_000_000_001],
    ['missing', undefined],
  ])('rejects an amount that is %s', async (_label, amountReceived) => {
    expect(await messages({ ...valid, amountReceived })).toMatch(
      /amountReceived/,
    );
  });

  it.each(['CASH', 'bank transfer', 'UPI', 'cheque', 'Card', 'other'])(
    'accepts the mode %s',
    async (paymentMode) => {
      expect(await messages({ ...valid, paymentMode })).toBe('');
    },
  );

  it.each(['', 'NEFT', 'bitcoin', 'RTGS', 5, null])(
    'rejects the unknown mode %p with a message that lists the allowed ones',
    async (paymentMode) => {
      const msg = await messages({ ...valid, paymentMode });

      expect(msg).toMatch(
        /paymentMode must be one of: CASH, BANK_TRANSFER, UPI, CHEQUE, CARD, OTHER/,
      );
    },
  );

  it.each([
    ['blank', '   '],
    ['empty', ''],
    ['missing', undefined],
    ['too long', 'x'.repeat(101)],
  ])('rejects a reference that is %s', async (_label, referenceNo) => {
    expect(await messages({ ...valid, referenceNo })).toMatch(/referenceNo/);
  });

  it.each([
    ['not a date', 'yesterday'],
    ['an impossible date', '2026-02-31'],
    ['in the future', '2999-01-01'],
    ['missing', undefined],
  ])('rejects a payment date that is %s', async (_label, paymentDate) => {
    expect(await messages({ ...valid, paymentDate })).toMatch(
      /paymentDate|payment date/,
    );
  });

  it('says one thing about a date that is not a date, not two', async () => {
    const msg = JSON.parse(
      await messages({ ...valid, paymentDate: 'tomorrow' }),
    ) as { message: string[] };

    expect(
      msg.message.filter((m) => /paymentDate|payment date/.test(m)),
    ).toHaveLength(1);
  });

  it('accepts a plain date', async () => {
    expect(await messages({ ...valid, paymentDate: '2026-09-21' })).toBe('');
  });

  it('rejects an invoice id that is not a UUID', async () => {
    expect(await messages({ ...valid, salesInvoiceId: 'INV-1' })).toMatch(
      /salesInvoiceId/,
    );
  });

  it('rejects fields the client must not send (recorder, status, balances)', async () => {
    for (const extra of [
      { recordedById: 'x' },
      { actorId: 'x' },
      { paymentStatus: 'PAID' },
      { balanceAmount: 0 },
      { accountsReceivableId: INVOICE },
    ]) {
      expect(await messages({ ...valid, ...extra })).toMatch(
        /should not exist/,
      );
    }
  });

  it('rejects remarks that are too long', async () => {
    expect(await messages({ ...valid, remarks: 'x'.repeat(501) })).toMatch(
      /remarks/,
    );
  });
});

describe('ListPaymentCollectionsQueryDto', () => {
  const list = (value: unknown) => run(ListPaymentCollectionsQueryDto, value);

  it('accepts no filters and coerces the page to numbers', async () => {
    await expect(list({})).resolves.toBeDefined();

    const q = (await list({
      limit: '50',
      offset: '10',
    })) as ListPaymentCollectionsQueryDto;

    expect(q.limit).toBe(50);
    expect(q.offset).toBe(10);
  });

  it.each([
    { limit: '0' },
    { limit: '501' },
    { offset: '-1' },
    { limit: 'abc' },
    { salesInvoiceId: 'nope' },
    { from: 'x' },
    { mode: 'CASH' },
  ])('rejects %p', async (value) => {
    await expect(list(value)).rejects.toBeInstanceOf(BadRequestException);
  });
});
