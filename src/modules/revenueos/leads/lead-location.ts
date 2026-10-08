import { BadRequestException } from '@nestjs/common';

import { GST_STATES } from '../customer-gst/customer-gst-values';

// Where a lead is. Three nullable fields on Lead:
//   country  ISO 3166-1 alpha-2 code. "IN" is the domestic case.
//   state    a state or union territory of India. Only when country is "IN".
//   city     free text: the city or the specific location.
// All three are null when no location was recorded: every lead that existed
// before this was kept, and leads created by the WhatsApp bot or a webhook.
// Nothing here ever infers a country from a phone number, a name or a source.

export const LEAD_COUNTRY_INDIA = 'IN';
export const LEAD_CITY_MAX_LENGTH = 100;

// The 249 officially assigned ISO 3166-1 alpha-2 codes. The frontend carries
// the English names and calling codes for the same codes; its test compares the
// two sets so they cannot drift.
export const LEAD_COUNTRY_CODES: readonly string[] = [
  'AD',
  'AE',
  'AF',
  'AG',
  'AI',
  'AL',
  'AM',
  'AO',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AW',
  'AX',
  'AZ',
  'BA',
  'BB',
  'BD',
  'BE',
  'BF',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BL',
  'BM',
  'BN',
  'BO',
  'BQ',
  'BR',
  'BS',
  'BT',
  'BV',
  'BW',
  'BY',
  'BZ',
  'CA',
  'CC',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CK',
  'CL',
  'CM',
  'CN',
  'CO',
  'CR',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DE',
  'DJ',
  'DK',
  'DM',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'EH',
  'ER',
  'ES',
  'ET',
  'FI',
  'FJ',
  'FK',
  'FM',
  'FO',
  'FR',
  'GA',
  'GB',
  'GD',
  'GE',
  'GF',
  'GG',
  'GH',
  'GI',
  'GL',
  'GM',
  'GN',
  'GP',
  'GQ',
  'GR',
  'GS',
  'GT',
  'GU',
  'GW',
  'GY',
  'HK',
  'HM',
  'HN',
  'HR',
  'HT',
  'HU',
  'ID',
  'IE',
  'IL',
  'IM',
  'IN',
  'IO',
  'IQ',
  'IR',
  'IS',
  'IT',
  'JE',
  'JM',
  'JO',
  'JP',
  'KE',
  'KG',
  'KH',
  'KI',
  'KM',
  'KN',
  'KP',
  'KR',
  'KW',
  'KY',
  'KZ',
  'LA',
  'LB',
  'LC',
  'LI',
  'LK',
  'LR',
  'LS',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MF',
  'MG',
  'MH',
  'MK',
  'ML',
  'MM',
  'MN',
  'MO',
  'MP',
  'MQ',
  'MR',
  'MS',
  'MT',
  'MU',
  'MV',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NA',
  'NC',
  'NE',
  'NF',
  'NG',
  'NI',
  'NL',
  'NO',
  'NP',
  'NR',
  'NU',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PM',
  'PN',
  'PR',
  'PS',
  'PT',
  'PW',
  'PY',
  'QA',
  'RE',
  'RO',
  'RS',
  'RU',
  'RW',
  'SA',
  'SB',
  'SC',
  'SD',
  'SE',
  'SG',
  'SH',
  'SI',
  'SJ',
  'SK',
  'SL',
  'SM',
  'SN',
  'SO',
  'SR',
  'SS',
  'ST',
  'SV',
  'SX',
  'SY',
  'SZ',
  'TC',
  'TD',
  'TF',
  'TG',
  'TH',
  'TJ',
  'TK',
  'TL',
  'TM',
  'TN',
  'TO',
  'TR',
  'TT',
  'TV',
  'TW',
  'TZ',
  'UA',
  'UG',
  'UM',
  'US',
  'UY',
  'UZ',
  'VA',
  'VC',
  'VE',
  'VG',
  'VI',
  'VN',
  'VU',
  'WF',
  'WS',
  'YE',
  'YT',
  'ZA',
  'ZM',
  'ZW',
];

const COUNTRY_SET = new Set(LEAD_COUNTRY_CODES);

// India's states and union territories: the names customer GST registrations
// already use, without code 97 ("Other Territory"), which is not a place.
export const LEAD_INDIA_STATES: readonly string[] = Object.entries(GST_STATES)
  .filter(([code]) => code !== '97')
  .map(([, name]) => name);

export interface LeadLocation {
  country: string | null;
  state: string | null;
  city: string | null;
}

// What a PATCH may say about the location: a field that is absent keeps what is
// stored, null clears it.
export type LeadLocationChange = Partial<LeadLocation>;

export const LEAD_LOCATION_MESSAGE = {
  COUNTRY_UNKNOWN: 'country must be a valid ISO 3166-1 alpha-2 country code.',
  COUNTRY_REQUIRED: 'A location needs a country.',
  STATE_REQUIRED: 'A state is required for a lead in India.',
  STATE_UNKNOWN: 'state must be a state or union territory of India.',
  STATE_ONLY_IN_INDIA: 'A state can only be recorded for a lead in India.',
  CITY_TOO_LONG: `city must be at most ${LEAD_CITY_MAX_LENGTH} characters.`,
} as const;

export function isLeadCountryCode(value: unknown): value is string {
  return typeof value === 'string' && COUNTRY_SET.has(value);
}

// The canonical spelling of an Indian state, or null when it is not one. The
// comparison ignores case and surrounding spaces; the stored value never does.
export function canonicalIndiaState(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const wanted = value.trim().toLowerCase();

  return (
    LEAD_INDIA_STATES.find((state) => state.toLowerCase() === wanted) ?? null
  );
}

export const EMPTY_LEAD_LOCATION: Readonly<LeadLocation> = {
  country: null,
  state: null,
  city: null,
};

// The location a lead would have after a change. undefined keeps, null clears.
export function mergeLeadLocation(
  existing: LeadLocation,
  change: LeadLocationChange,
): LeadLocation {
  return {
    country: change.country === undefined ? existing.country : change.country,
    state: change.state === undefined ? existing.state : change.state,
    city: change.city === undefined ? existing.city : change.city,
  };
}

// The rules, applied to the whole location (never to one field in isolation).
export function assertLeadLocation(location: LeadLocation): void {
  const { country, state, city } = location;

  if (city !== null && city.length > LEAD_CITY_MAX_LENGTH) {
    throw new BadRequestException(LEAD_LOCATION_MESSAGE.CITY_TOO_LONG);
  }

  if (country === null) {
    if (state !== null || city !== null) {
      throw new BadRequestException(LEAD_LOCATION_MESSAGE.COUNTRY_REQUIRED);
    }

    return;
  }

  if (!isLeadCountryCode(country)) {
    throw new BadRequestException(LEAD_LOCATION_MESSAGE.COUNTRY_UNKNOWN);
  }

  if (country === LEAD_COUNTRY_INDIA) {
    if (state === null) {
      throw new BadRequestException(LEAD_LOCATION_MESSAGE.STATE_REQUIRED);
    }

    if (canonicalIndiaState(state) !== state) {
      throw new BadRequestException(LEAD_LOCATION_MESSAGE.STATE_UNKNOWN);
    }

    return;
  }

  if (state !== null) {
    throw new BadRequestException(LEAD_LOCATION_MESSAGE.STATE_ONLY_IN_INDIA);
  }
}

// How the request fields are read before they are validated. A blank value means
// "no value" (null); a country is upper-cased; a state that matches an Indian
// state ignoring case is replaced by its canonical spelling. Anything that is not
// a string is left alone for the validators to refuse.
export function normalizeCountryInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim().toUpperCase();

  return trimmed === '' ? null : trimmed;
}

export function normalizeStateInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? null : (canonicalIndiaState(trimmed) ?? trimmed);
}

export function normalizeCityInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
}
