import {
  fromPaise,
  formatRupees,
  isNotFutureDate,
  isRupeeAmount,
  normalizePaymentMode,
  referenceKey,
  toPaise,
} from './payment-collection-values';

describe('payment collection values', () => {
  describe('money in paise', () => {
    it('turns rupees into whole paise without drift', () => {
      expect(toPaise(0.1) + toPaise(0.2)).toBe(30);
      expect(toPaise(295000)).toBe(29_500_000);
      expect(toPaise(1234.56)).toBe(123_456);
      expect(toPaise(19.99)).toBe(1999);
      expect(fromPaise(toPaise(1234.56))).toBe(1234.56);
    });

    it('accepts a rupee amount: at most two decimals, at least a paisa, exact', () => {
      for (const ok of [
        0.01, 1, 100.1, 100.1, 1234.56, 295000, 19.99, 999999999.99, 0.3,
      ]) {
        expect(isRupeeAmount(ok)).toBe(true);
      }
    });

    it('refuses everything else, including exponent forms that class-validator cannot read', () => {
      for (const bad of [
        0,
        -1,
        0.001,
        100.105,
        1e-7,
        1.005,
        NaN,
        Infinity,
        '100',
        null,
        undefined,
      ]) {
        expect(isRupeeAmount(bad)).toBe(false);
      }
    });

    it('writes rupees the Indian way', () => {
      expect(formatRupees(29_500_000)).toBe('₹2,95,000.00');
      expect(formatRupees(5)).toBe('₹0.05');
    });
  });

  describe('payment mode', () => {
    it('reads the same mode however it was typed', () => {
      for (const v of [
        'BANK_TRANSFER',
        'Bank Transfer',
        ' bank-transfer ',
        'bank  transfer',
      ]) {
        expect(normalizePaymentMode(v)).toBe('BANK_TRANSFER');
      }
      expect(normalizePaymentMode('upi')).toBe('UPI');
      expect(normalizePaymentMode(42)).toBe(42);
    });
  });

  describe('reference', () => {
    it('is the same payment when only case or surrounding spaces differ', () => {
      expect(referenceKey('  UTR-10001 ')).toBe(referenceKey('utr-10001'));
      expect(referenceKey('UTR-10001')).not.toBe(referenceKey('UTR-10002'));
    });
  });

  describe('payment date', () => {
    const now = new Date('2026-10-08T10:00:00.000Z');

    it('allows today, the past, and up to a day ahead', () => {
      expect(isNotFutureDate('2026-10-08T00:00:00.000Z', now)).toBe(true);
      expect(isNotFutureDate('2026-06-24', now)).toBe(true);
      expect(isNotFutureDate('2026-10-09T09:00:00.000Z', now)).toBe(true);
    });

    it('refuses anything later, and anything that is not a date', () => {
      expect(isNotFutureDate('2026-10-09T11:00:00.000Z', now)).toBe(false);
      expect(isNotFutureDate('2027-01-01', now)).toBe(false);
      expect(isNotFutureDate('not a date', now)).toBe(false);
      expect(isNotFutureDate(undefined, now)).toBe(false);
    });
  });
});
