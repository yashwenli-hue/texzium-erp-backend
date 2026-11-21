import { BadRequestException } from '@nestjs/common';
import { MAX_RANGE_DAYS, parseFollowupRange } from './followup-range';

describe('parseFollowupRange', () => {
  it('accepts a window of up to the maximum', () => {
    const r = parseFollowupRange(
      '2026-11-01T00:00:00.000Z',
      '2026-12-01T00:00:00.000Z',
    );
    expect(r.from.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    const max = new Date(
      Date.UTC(2026, 0, 1) + MAX_RANGE_DAYS * 86400000,
    ).toISOString();
    expect(() =>
      parseFollowupRange('2026-01-01T00:00:00.000Z', max),
    ).not.toThrow();
  });

  it.each([
    [undefined, '2026-11-02T00:00:00Z', 'from is required'],
    ['2026-11-01T00:00:00Z', '', 'to is required'],
    ['yesterday', '2026-11-02T00:00:00Z', 'from is not a valid'],
    ['2026-11-02T00:00:00Z', '2026-11-02T00:00:00Z', 'to must be after from'],
    ['2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z', 'to must be after from'],
    ['2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z', 'at most'],
  ])('rejects from=%p to=%p', (from, to, message) => {
    expect(() => parseFollowupRange(from, to)).toThrow(BadRequestException);
    expect(() => parseFollowupRange(from, to)).toThrow(message);
  });
});
