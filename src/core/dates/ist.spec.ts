import {
  indianFinancialYear,
  isCalendarDay,
  istCalendarDay,
  istDayStart,
  istNextDayStart,
} from './ist';

describe('India Standard Time calendar days', () => {
  it('a date-only value stored as midnight UTC is the same Indian day', () => {
    expect(istCalendarDay(new Date('2026-06-30T00:00:00.000Z'))).toBe(
      '2026-06-30',
    );
  });

  it('a clock timestamp after 18:30 UTC is already the next Indian day', () => {
    expect(istCalendarDay(new Date('2026-06-30T18:29:59.999Z'))).toBe(
      '2026-06-30',
    );
    expect(istCalendarDay(new Date('2026-06-30T18:30:00.000Z'))).toBe(
      '2026-07-01',
    );
  });

  it('a day starts at 18:30 UTC of the previous UTC day and lasts 24 hours', () => {
    expect(istDayStart('2026-07-01').toISOString()).toBe(
      '2026-06-30T18:30:00.000Z',
    );
    expect(istNextDayStart('2026-07-01').toISOString()).toBe(
      '2026-07-01T18:30:00.000Z',
    );
    expect(istNextDayStart('2026-12-31').toISOString()).toBe(
      '2026-12-31T18:30:00.000Z',
    );
  });

  it('only real "YYYY-MM-DD" days are calendar days', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
    for (const bad of [
      '2026-02-30',
      '2026-13-01',
      '2026-1-01',
      '01-04-2026',
      '2026-04-01T00:00:00Z',
      '',
      null,
      20260401,
    ]) {
      expect(isCalendarDay(bad)).toBe(false);
    }
    expect(() => istDayStart('2026-02-30')).toThrow();
  });

  it('the Indian financial year runs from 1 April to 31 March', () => {
    expect(indianFinancialYear('2026-03-31')).toEqual({
      label: '2025-26',
      short: '25-26',
      startYear: 2025,
    });
    expect(indianFinancialYear('2026-04-01')).toEqual({
      label: '2026-27',
      short: '26-27',
      startYear: 2026,
    });
    expect(indianFinancialYear('2099-12-31')).toEqual({
      label: '2099-00',
      short: '99-00',
      startYear: 2099,
    });
  });
});
