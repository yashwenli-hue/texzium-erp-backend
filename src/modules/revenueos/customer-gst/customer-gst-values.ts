// Format rules for a customer's GST registration. GST validity itself belongs
// to ComplianceOS; RevenueOS checks only what it needs to sell: that a GSTIN is
// well formed, which state it is in, and whose PAN it carries.

export const GST_NAME_MAX_LENGTH = 200;
export const GST_ADDRESS_MAX_LENGTH = 200;
export const GST_CITY_MAX_LENGTH = 100;
export const GST_REASON_MAX_LENGTH = 500;

// 2 digit state code, the 10 character PAN, an entity number (1-9 or a
// letter), the letter Z, and a check character. The check character is NOT
// verified: both GSTINs on file today were entered as test data and fail the
// checksum, and verifying it is a compliance matter.
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// An Indian PIN code: six digits, not starting with 0.
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

// The state codes a GSTIN can start with, with the names the registrations on
// file already use. Codes 25 (Daman and Diu) and 28 (Andhra Pradesh, before
// the split) are no longer issued, and 99 is the centre jurisdiction, which
// never carries a buyer's registration.
export const GST_STATES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export function normalizeGstin(gstin: string): string {
  return gstin.trim().toUpperCase();
}

export function gstinStateCode(gstin: string): string {
  return gstin.slice(0, 2);
}

// The PAN a GSTIN carries: characters 3 to 12.
export function gstinPan(gstin: string): string {
  return gstin.slice(2, 12);
}

// The state a GSTIN is registered in, or null when its code is not one that
// can be issued.
export function gstinState(
  gstin: string,
): { stateCode: string; stateName: string } | null {
  const stateCode = gstinStateCode(gstin);
  const stateName = GST_STATES[stateCode];

  return stateName ? { stateCode, stateName } : null;
}

// Does the PAN inside the GSTIN belong to the customer? A customer without a
// PAN has nothing to disagree with.
export function gstinMatchesPan(
  gstin: string,
  customerPan: string | null,
): boolean {
  if (customerPan === null || customerPan.trim() === '') return true;

  return gstinPan(gstin) === customerPan.trim().toUpperCase();
}

// The editable details of a registration. The GSTIN and the state are not
// among them: a registration is identified by its GSTIN, so a different one
// is a new registration.
export const GST_EDITABLE_FIELDS = [
  'legalName',
  'tradeName',
  'branchName',
  'addressLine1',
  'addressLine2',
  'city',
  'pincode',
] as const;

export type GstEditableField = (typeof GST_EDITABLE_FIELDS)[number];

export type GstChange = { from: string | null; to: string | null };
export type GstChanges = Partial<Record<GstEditableField, GstChange>>;

// The fields an edit actually changes: only those present in the request
// whose value differs from the stored one. `undefined` means "leave it",
// `null` means "clear it".
export function diffGstFields(
  current: Record<GstEditableField, string | null>,
  requested: Partial<Record<GstEditableField, string | null>>,
): GstChanges {
  const changes: GstChanges = {};

  for (const field of GST_EDITABLE_FIELDS) {
    const next = requested[field];

    if (next === undefined) continue;
    if (next === current[field]) continue;

    changes[field] = { from: current[field], to: next };
  }

  return changes;
}
