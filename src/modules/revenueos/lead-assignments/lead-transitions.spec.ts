import { LeadStatus } from '@prisma/client';

import {
  LEAD_BEFORE_QUALIFICATION,
  LEAD_CLOSED,
  LEAD_QUALIFIED_OR_IN_SALES,
  LEAD_REOPEN_TARGET,
  canCreateOpportunityFor,
  canMoveLeadStatus,
  canQualifyLeadFrom,
  canReopenLeadFrom,
  opportunityRefusal,
  reopenRefusal,
  statusMoveRefusal,
} from './lead-transitions';

// The lifecycle rules as one table. Every backend status is in exactly one group.
const ALL = Object.values(LeadStatus);

describe('lead lifecycle rules', () => {
  it('puts every status in exactly one group', () => {
    const groups = [
      ...LEAD_BEFORE_QUALIFICATION,
      ...LEAD_QUALIFIED_OR_IN_SALES,
      ...LEAD_CLOSED,
    ];
    expect([...groups].sort()).toEqual([...ALL].sort());
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('treats Underqualified as pre-qualification work', () => {
    expect(LEAD_BEFORE_QUALIFICATION).toContain('UNDERQUALIFIED');
    expect(canQualifyLeadFrom('UNDERQUALIFIED')).toBe(true);
  });

  it('lets a lead marked Qualified without a sales hand-off be handed over, but not a qualified one in sales', () => {
    expect(canQualifyLeadFrom('QUALIFIED')).toBe(true);
    for (const s of ['SALES_ASSIGNED', 'PROPOSAL_SENT', 'NEGOTIATION', ...LEAD_CLOSED] as LeadStatus[]) {
      expect(canQualifyLeadFrom(s)).toBe(false);
    }
  });

  it('reopens only a rejected lead, to Contacted', () => {
    expect(ALL.filter(canReopenLeadFrom)).toEqual(['REJECTED']);
    expect(LEAD_REOPEN_TARGET).toBe('CONTACTED');
    expect(reopenRefusal('WON')).toBe('Only a rejected lead can be reopened; this one is Won.');
    expect(reopenRefusal('NEW')).toBe('This lead is open (New); only a rejected lead can be reopened.');
  });

  it('creates opportunities only for qualified, in-sales or won leads', () => {
    expect(ALL.filter(canCreateOpportunityFor).sort()).toEqual(
      ['NEGOTIATION', 'PROPOSAL_SENT', 'QUALIFIED', 'SALES_ASSIGNED', 'WON'].sort(),
    );
    expect(opportunityRefusal('CONTACTED')).toBe(
      'An opportunity can only be created for a qualified lead; this one is Contacted.',
    );
  });

  it('allows the status endpoint only pre-qualification moves', () => {
    const allowed: string[] = [];
    for (const from of ALL) for (const to of ALL) if (canMoveLeadStatus(from, to)) allowed.push(`${from}>${to}`);
    // every pre-qualification status may go to New, Contacted or Underqualified (not to itself)
    const expected: string[] = [];
    for (const from of LEAD_BEFORE_QUALIFICATION)
      for (const to of ['NEW', 'CONTACTED', 'UNDERQUALIFIED'] as LeadStatus[]) if (from !== to) expected.push(`${from}>${to}`);
    expect(allowed.sort()).toEqual(expected.sort());
  });

  it('explains every refused status move', () => {
    expect(statusMoveRefusal('NEW', 'NEW')).toBe('This lead is already New.');
    expect(statusMoveRefusal('NEW', 'QUALIFIED')).toMatch(/^Qualified is not set here/);
    expect(statusMoveRefusal('REJECTED', 'CONTACTED')).toBe('This lead is closed (Rejected); reopen it first.');
    expect(statusMoveRefusal('SALES_ASSIGNED', 'CONTACTED')).toMatch(/already been qualified/);
  });
});
