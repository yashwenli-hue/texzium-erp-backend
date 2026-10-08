import * as fs from 'fs';
import * as path from 'path';

import { BadRequestException } from '@nestjs/common';

import { GST_STATES } from '../customer-gst/customer-gst-values';
import {
  EMPTY_LEAD_LOCATION,
  LEAD_CITY_MAX_LENGTH,
  LEAD_COUNTRY_CODES,
  LEAD_INDIA_STATES,
  LEAD_LOCATION_MESSAGE,
  LeadLocation,
  assertLeadLocation,
  canonicalIndiaState,
  isLeadCountryCode,
  mergeLeadLocation,
  normalizeCityInput,
  normalizeCountryInput,
  normalizeStateInput,
} from './lead-location';

const loc = (
  country: string | null,
  state: string | null,
  city: string | null,
): LeadLocation => ({ country, state, city });
const refused = (l: LeadLocation, message: string) => {
  try {
    assertLeadLocation(l);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    expect((e as BadRequestException).message).toBe(message);
    return;
  }
  throw new Error(`expected ${JSON.stringify(l)} to be refused`);
};

describe('Lead location rules', () => {
  describe('the lists', () => {
    it('has the 249 officially assigned ISO 3166-1 alpha-2 codes, upper case and unique', () => {
      expect(LEAD_COUNTRY_CODES).toHaveLength(249);
      expect(new Set(LEAD_COUNTRY_CODES).size).toBe(249);
      expect(LEAD_COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    });

    it('contains the countries a sales team meets and none of the retired or reserved codes', () => {
      for (const c of [
        'IN',
        'US',
        'GB',
        'AE',
        'SG',
        'DE',
        'CN',
        'JP',
        'AU',
        'BD',
        'LK',
        'NP',
        'ZA',
        'KR',
        'SA',
      ]) {
        expect(isLeadCountryCode(c)).toBe(true);
      }
      for (const c of [
        'UK',
        'EU',
        'UN',
        'XK',
        'SU',
        'YU',
        'AN',
        'ZZ',
        'RH',
        'in',
        'IND',
        '',
        null,
        undefined,
        91,
      ]) {
        expect(isLeadCountryCode(c as unknown)).toBe(false);
      }
    });

    it('lists India\'s 36 states and union territories: the GST names, without "Other Territory"', () => {
      expect(LEAD_INDIA_STATES).toHaveLength(36);
      expect(LEAD_INDIA_STATES).not.toContain('Other Territory');
      expect(LEAD_INDIA_STATES).toEqual(
        Object.entries(GST_STATES)
          .filter(([code]) => code !== '97')
          .map(([, n]) => n),
      );
      for (const s of [
        'Maharashtra',
        'Gujarat',
        'Delhi',
        'Tamil Nadu',
        'Ladakh',
        'Jammu and Kashmir',
        'Telangana',
      ]) {
        expect(LEAD_INDIA_STATES).toContain(s);
      }
    });
  });

  describe('the whole location is judged together', () => {
    it.each([
      [
        'no location at all (a legacy lead, a WhatsApp or webhook lead)',
        loc(null, null, null),
      ],
      ['India with a state', loc('IN', 'Maharashtra', null)],
      ['India with a state and a city', loc('IN', 'Gujarat', 'Surat')],
      ['a foreign country alone', loc('AE', null, null)],
      ['a foreign country with a city', loc('US', null, 'Austin')],
      [
        'a city exactly at the limit',
        loc('GB', null, 'x'.repeat(LEAD_CITY_MAX_LENGTH)),
      ],
    ])('accepts %s', (_n, l) => {
      expect(() => assertLeadLocation(l)).not.toThrow();
    });

    it('refuses a state or a city without a country', () => {
      refused(
        loc(null, 'Maharashtra', null),
        LEAD_LOCATION_MESSAGE.COUNTRY_REQUIRED,
      );
      refused(loc(null, null, 'Pune'), LEAD_LOCATION_MESSAGE.COUNTRY_REQUIRED);
      refused(
        loc(null, 'Goa', 'Panaji'),
        LEAD_LOCATION_MESSAGE.COUNTRY_REQUIRED,
      );
    });

    it('requires a state for India, and a real one', () => {
      refused(loc('IN', null, null), LEAD_LOCATION_MESSAGE.STATE_REQUIRED);
      refused(loc('IN', null, 'Pune'), LEAD_LOCATION_MESSAGE.STATE_REQUIRED);
      refused(loc('IN', 'Atlantis', null), LEAD_LOCATION_MESSAGE.STATE_UNKNOWN);
      refused(
        loc('IN', 'maharashtra', null),
        LEAD_LOCATION_MESSAGE.STATE_UNKNOWN,
      );
      refused(
        loc('IN', 'Other Territory', null),
        LEAD_LOCATION_MESSAGE.STATE_UNKNOWN,
      );
    });

    it('refuses a state on any country other than India', () => {
      refused(
        loc('AE', 'Maharashtra', null),
        LEAD_LOCATION_MESSAGE.STATE_ONLY_IN_INDIA,
      );
      refused(
        loc('US', 'Texas', 'Austin'),
        LEAD_LOCATION_MESSAGE.STATE_ONLY_IN_INDIA,
      );
    });

    it('refuses an unknown country and a city that is too long', () => {
      refused(loc('XX', null, null), LEAD_LOCATION_MESSAGE.COUNTRY_UNKNOWN);
      refused(loc('in', 'Goa', null), LEAD_LOCATION_MESSAGE.COUNTRY_UNKNOWN);
      refused(
        loc('IN', 'Goa', 'x'.repeat(LEAD_CITY_MAX_LENGTH + 1)),
        LEAD_LOCATION_MESSAGE.CITY_TOO_LONG,
      );
    });
  });

  describe('a change is merged with what is stored', () => {
    const india = loc('IN', 'Gujarat', 'Surat');

    it('keeps every field that is absent, changes the ones given, clears a null', () => {
      expect(mergeLeadLocation(india, {})).toEqual(india);
      expect(mergeLeadLocation(india, { city: 'Vadodara' })).toEqual(
        loc('IN', 'Gujarat', 'Vadodara'),
      );
      expect(mergeLeadLocation(india, { city: null })).toEqual(
        loc('IN', 'Gujarat', null),
      );
      expect(
        mergeLeadLocation(india, { country: null, state: null, city: null }),
      ).toEqual(EMPTY_LEAD_LOCATION);
    });

    it('does not let a lead leave India while keeping its state', () => {
      refused(
        mergeLeadLocation(india, { country: 'AE' }),
        LEAD_LOCATION_MESSAGE.STATE_ONLY_IN_INDIA,
      );
      expect(() =>
        assertLeadLocation(
          mergeLeadLocation(india, { country: 'AE', state: null }),
        ),
      ).not.toThrow();
    });

    it('does not let a foreign lead become Indian without a state', () => {
      const uae = loc('AE', null, 'Dubai');
      refused(
        mergeLeadLocation(uae, { country: 'IN' }),
        LEAD_LOCATION_MESSAGE.STATE_REQUIRED,
      );
      expect(() =>
        assertLeadLocation(
          mergeLeadLocation(uae, { country: 'IN', state: 'Goa' }),
        ),
      ).not.toThrow();
    });

    it('leaves a lead with no location valid when something else is edited, and refuses a city alone', () => {
      expect(() =>
        assertLeadLocation(mergeLeadLocation(EMPTY_LEAD_LOCATION, {})),
      ).not.toThrow();
      refused(
        mergeLeadLocation(EMPTY_LEAD_LOCATION, { city: 'Pune' }),
        LEAD_LOCATION_MESSAGE.COUNTRY_REQUIRED,
      );
    });
  });

  describe('how request values are read', () => {
    it('trims and upper-cases a country; blank means none; non-strings are left for the validators', () => {
      expect(normalizeCountryInput(' in ')).toBe('IN');
      expect(normalizeCountryInput('ae')).toBe('AE');
      expect(normalizeCountryInput('   ')).toBeNull();
      expect(normalizeCountryInput('')).toBeNull();
      expect(normalizeCountryInput(null)).toBeNull();
      expect(normalizeCountryInput(undefined)).toBeUndefined();
      expect(normalizeCountryInput(91)).toBe(91);
    });

    it('turns a state into its canonical spelling when it matches ignoring case, and leaves a stranger alone', () => {
      expect(canonicalIndiaState('  MAHARASHTRA ')).toBe('Maharashtra');
      expect(canonicalIndiaState('tamil nadu')).toBe('Tamil Nadu');
      expect(canonicalIndiaState('Mars')).toBeNull();
      expect(canonicalIndiaState(5)).toBeNull();
      expect(normalizeStateInput('goa')).toBe('Goa');
      expect(normalizeStateInput('  Mars ')).toBe('Mars');
      expect(normalizeStateInput('  ')).toBeNull();
      expect(normalizeStateInput(undefined)).toBeUndefined();
    });

    it('trims a city and reads blank as none, without changing the middle of it', () => {
      expect(normalizeCityInput('  Navi   Mumbai  ')).toBe('Navi   Mumbai');
      expect(normalizeCityInput('   ')).toBeNull();
      expect(normalizeCityInput(undefined)).toBeUndefined();
      expect(normalizeCityInput(7)).toBe(7);
    });
  });

  describe('the two M2 migrations stay additive', () => {
    const dir = path.join(__dirname, '../../../..', 'prisma/manual-migrations');
    // The statements that run: comments removed.
    const active = (file: string) =>
      fs
        .readFileSync(path.join(dir, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    it.each([
      '20261010_crm_leadtimeline_user_remark.sql',
      '20261010_crm_lead_location.sql',
    ])(
      '%s adds, and never reads, rewrites or removes, rows or columns',
      (file) => {
        const sql = active(file);
        expect(sql).not.toMatch(
          /\b(UPDATE|INSERT|DELETE|TRUNCATE|DROP|RENAME)\b/i,
        );
        expect(sql).not.toMatch(
          /\bSELECT\b[^;]*\bFROM\s+"(Lead|LeadTimeline)"/i,
        );
        expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/);
        expect(sql).toMatch(/^BEGIN;/m);
        expect(sql).toMatch(/^COMMIT;/m);
      },
    );

    it('adds the columns as nullable text with no default, so no existing row gets a value', () => {
      const remark = active('20261010_crm_leadtimeline_user_remark.sql');
      expect(remark).toMatch(/"userRemark" TEXT;/);
      const location = active('20261010_crm_lead_location.sql');
      for (const column of ['country', 'state', 'city']) {
        expect(location).toMatch(
          new RegExp(`ADD COLUMN IF NOT EXISTS "${column}" TEXT;`),
        );
      }
      const columns = `${remark}${location}`.match(/ADD COLUMN[^;]*;/g) ?? [];
      expect(columns).toHaveLength(4);
      for (const statement of columns)
        expect(statement).not.toMatch(/\bDEFAULT\b|\bNOT NULL\b/i);
    });

    it('tests the country with IS NOT NULL before the pattern, because a CHECK lets a NULL comparison through', () => {
      expect(active('20261010_crm_lead_location.sql')).toMatch(
        /"country" IS NOT NULL\s+AND "country" ~/,
      );
    });
  });
});
