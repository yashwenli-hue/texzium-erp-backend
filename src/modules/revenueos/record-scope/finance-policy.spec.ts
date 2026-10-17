/* eslint-disable @typescript-eslint/no-unsafe-argument -- test doubles are intentionally loosely typed */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { assertHoldsAll } from '../../adminos/identity-admin';
import { maskGatewayConfig } from '../../adminos/payment-gateway-config/payment-gateway-config.controller';
import { enquiryKind, enquiryStrength } from '../leads/lead-duplicates';
import { FinanceVisibilityGuard } from './finance-visibility.guard';
import {
  FINANCE_KINDS,
  financeScopeOf,
  hasFinanceVisibility,
  scopeOf,
} from './record-scope';

// The pure rules of the confirmed D3 policy (2026-10-17). Their behaviour over HTTP on a
// real database is in test/integration/d3-policy and returning-leads.

const user = (permissions: string[]) => ({ id: 'u1', permissions });
const ctx = (u: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user: u }) }) }) as any;

describe('finance visibility', () => {
  it('finance.view.all widens only the financial kinds; revenue.view.all includes it', () => {
    expect(financeScopeOf(user(['finance.view.all']))).toEqual({ all: true });
    expect(scopeOf(user(['finance.view.all']))).toEqual({
      all: false,
      userId: 'u1',
    });
    expect(financeScopeOf(user(['revenue.view.all']))).toEqual({ all: true });
    expect(financeScopeOf(user(['invoices.view']))).toEqual({
      all: false,
      userId: 'u1',
    });
    expect([...FINANCE_KINDS].sort()).toEqual([
      'advanceReceipt',
      'paymentCollection',
      'receiptVoucher',
      'salesInvoice',
    ]);
    expect(
      hasFinanceVisibility({ id: 'u1', permissions: 'finance.view.all' }),
    ).toBe(false);
    expect(() => financeScopeOf(undefined)).toThrow(UnauthorizedException);
  });

  it('the guard admits finance visibility only', () => {
    const g = new FinanceVisibilityGuard();
    expect(g.canActivate(ctx(user(['finance.view.all'])))).toBe(true);
    expect(g.canActivate(ctx(user(['revenue.view.all'])))).toBe(true);
    expect(() => g.canActivate(ctx(user(['invoices.view'])))).toThrow(
      ForbiddenException,
    );
    expect(() => g.canActivate(ctx(undefined))).toThrow(UnauthorizedException);
  });

  it('hold-what-you-grant: revenue.view.all covers finance.view.all, never the reverse', () => {
    expect(() =>
      assertHoldsAll(user(['revenue.view.all']), ['finance.view.all'], 'grant'),
    ).not.toThrow();
    expect(() =>
      assertHoldsAll(user(['finance.view.all']), ['revenue.view.all'], 'grant'),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertHoldsAll(user(['leads.view']), ['finance.view.all'], 'grant'),
    ).toThrow(ForbiddenException);
  });
});

describe('payment-gateway settings', () => {
  it('show the account number by its last four characters only', () => {
    expect(
      maskGatewayConfig({
        id: 'g',
        accountNumber: '000111222333',
        upiId: 'x@y',
      }),
    ).toEqual({ id: 'g', accountNumber: '••••2333', upiId: 'x@y' });
    expect(maskGatewayConfig({ id: 'g', accountNumber: '12' })).toEqual({
      id: 'g',
      accountNumber: '••••',
    });
    expect(maskGatewayConfig(null)).toBeNull();
  });
});

describe('returning enquiries', () => {
  const m = (
    o: Partial<
      Record<'phoneMatch' | 'emailMatch' | 'sameName' | 'sameCompany', boolean>
    >,
  ) => ({
    phoneMatch: false,
    emailMatch: false,
    sameName: false,
    sameCompany: false,
    ...o,
  });

  it('a phone number alone is never "the same person"', () => {
    expect(enquiryStrength(m({ phoneMatch: true }))).toBe('POSSIBLE');
    expect(enquiryStrength(m({ phoneMatch: true, sameCompany: true }))).toBe(
      'STRONG',
    );
    expect(enquiryStrength(m({ emailMatch: true }))).toBe('STRONG');
    expect(enquiryStrength(m({ phoneMatch: true, sameName: true }))).toBe(
      'EXACT',
    );
    expect(enquiryStrength(m({ phoneMatch: true, emailMatch: true }))).toBe(
      'EXACT',
    );
  });

  it('open + same (or unknown) product is a possible duplicate; another product or a closed one is a repeat enquiry', () => {
    const open = { status: 'CONTACTED', isActive: true };
    expect(
      enquiryKind('EXACT', { ...open, inventoryItemId: 'a' }, 'a'),
    ).toEqual({
      kind: 'POTENTIAL_DUPLICATE',
      sameProduct: true,
    });
    expect(
      enquiryKind('EXACT', { ...open, inventoryItemId: null }, 'a'),
    ).toEqual({
      kind: 'POTENTIAL_DUPLICATE',
      sameProduct: null,
    });
    expect(
      enquiryKind('STRONG', { ...open, inventoryItemId: 'b' }, 'a').kind,
    ).toBe('REPEAT_ENQUIRY');
    for (const status of ['WON', 'LOST', 'REJECTED'])
      expect(
        enquiryKind(
          'EXACT',
          { status, isActive: true, inventoryItemId: 'a' },
          'a',
        ).kind,
      ).toBe('REPEAT_ENQUIRY');
    expect(
      enquiryKind(
        'EXACT',
        { ...open, isActive: false, inventoryItemId: 'a' },
        'a',
      ).kind,
    ).toBe('REPEAT_ENQUIRY');
    expect(
      enquiryKind('POSSIBLE', { ...open, inventoryItemId: 'a' }, 'a').kind,
    ).toBe('POSSIBLE_MATCH');
  });
});
