import { quotationProgress } from './lead-quotation-progress';

const p = (
  status: string,
  proformaStatuses: string[] = [],
  orderStatuses: string[] = [],
) => quotationProgress({ status, proformaStatuses, orderStatuses });

describe('quotation progress, without prices', () => {
  it('a draft or revised quotation is being prepared', () => {
    expect(p('DRAFT')).toBe('IN_PREPARATION');
    expect(p('REVISED')).toBe('IN_PREPARATION');
  });

  it('approved, then proforma issued, then customer accepted, then order placed', () => {
    expect(p('APPROVED')).toBe('APPROVED');
    expect(p('APPROVED', ['PENDING'])).toBe('PROFORMA_ISSUED');
    expect(p('APPROVED', ['APPROVED'])).toBe('CUSTOMER_ACCEPTED');
    expect(p('APPROVED', ['APPROVED'], ['PENDING_STORE_APPROVAL'])).toBe(
      'ORDER_PLACED',
    );
  });

  it('a cancelled proforma or order does not count', () => {
    expect(p('APPROVED', ['CANCELLED'])).toBe('APPROVED');
    expect(p('APPROVED', ['APPROVED'], ['CANCELLED'])).toBe(
      'CUSTOMER_ACCEPTED',
    );
  });

  it('rejected stays rejected', () => {
    expect(p('REJECTED', ['PENDING'])).toBe('REJECTED');
  });

  it('an order made straight from the quotation (older path) still counts', () => {
    expect(p('APPROVED', [], ['OPEN'])).toBe('ORDER_PLACED');
  });
});
