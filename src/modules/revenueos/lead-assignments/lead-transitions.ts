import { LeadStatus } from '@prisma/client';

// Which lead statuses each lifecycle action may start from. Enforced here, in the
// backend, under the lock on the lead; the frontend only mirrors these rules.
//
//   before qualification   NEW, ASSIGNED, CONTACTED, PRE_SALES_ASSIGNED, UNDERQUALIFIED
//   qualified / in sales   QUALIFIED, SALES_ASSIGNED, PROPOSAL_SENT, NEGOTIATION
//   closed                 WON, LOST, REJECTED
//
//   assign   -> PRE_SALES_ASSIGNED  from before qualification (from PRE_SALES_ASSIGNED
//                                   only to a different user: a reassignment)
//   qualify  -> SALES_ASSIGNED      from before qualification, and from QUALIFIED: a lead
//                                   marked Qualified without a hand-off to sales (older
//                                   records, or the old status endpoint) can still be
//                                   handed to sales instead of being stuck
//   reject   -> REJECTED            from before qualification or qualified / in sales
//   reopen   -> CONTACTED           only from REJECTED (a reason is required; the
//                                   rejection stays in the history)
//   status   -> NEW / CONTACTED / UNDERQUALIFIED, the pre-qualification moves of
//               POST /lead-status, from before qualification only
//
// "Rejected" is the one stored state for a lead that was closed as not a fit; the
// screens may call it Disqualified. WON and LOST follow the opportunities and are not
// reopened here.
//
// Everything else is refused with 409.

export const LEAD_BEFORE_QUALIFICATION: readonly LeadStatus[] = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'PRE_SALES_ASSIGNED',
  'UNDERQUALIFIED',
];

export const LEAD_QUALIFIED_OR_IN_SALES: readonly LeadStatus[] = [
  'QUALIFIED',
  'SALES_ASSIGNED',
  'PROPOSAL_SENT',
  'NEGOTIATION',
];

export const LEAD_CLOSED: readonly LeadStatus[] = ['WON', 'LOST', 'REJECTED'];

/** The statuses an opportunity may be created for: a qualified lead, in sales, or won. */
export const LEAD_OPPORTUNITY_ELIGIBLE: readonly LeadStatus[] = [
  ...LEAD_QUALIFIED_OR_IN_SALES,
  'WON',
];

/** Where a reopened lead goes: back into pre-qualification work. */
export const LEAD_REOPEN_TARGET: LeadStatus = 'CONTACTED';

// Where a lead is in its lifecycle, grouping the canonical statuses (no status is added or
// renamed): for filtering a list by stage. REJECTED is the one "rejected / disqualified".
export const LEAD_STAGES = {
  PRE_QUALIFICATION: LEAD_BEFORE_QUALIFICATION,
  QUALIFIED: ['QUALIFIED', 'SALES_ASSIGNED'],
  IN_PROGRESS: ['PROPOSAL_SENT', 'NEGOTIATION'],
  WON: ['WON'],
  LOST: ['LOST'],
  REJECTED: ['REJECTED'],
} as const satisfies Record<string, readonly LeadStatus[]>;
export type LeadStage = keyof typeof LEAD_STAGES;
export const LEAD_STAGE_KEYS = Object.keys(LEAD_STAGES) as LeadStage[];

/** The statuses POST /lead-status may set. */
export const LEAD_STATUS_MOVE_TARGETS: readonly LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'UNDERQUALIFIED',
];

export const canAssignLeadFrom = (status: LeadStatus) =>
  LEAD_BEFORE_QUALIFICATION.includes(status);

export const canQualifyLeadFrom = (status: LeadStatus) =>
  LEAD_BEFORE_QUALIFICATION.includes(status) || status === 'QUALIFIED';

export const canRejectLeadFrom = (status: LeadStatus) =>
  !LEAD_CLOSED.includes(status);

export const canReopenLeadFrom = (status: LeadStatus) => status === 'REJECTED';

export const canCreateOpportunityFor = (status: LeadStatus) =>
  LEAD_OPPORTUNITY_ELIGIBLE.includes(status);

/** A pre-qualification move: from before qualification to another pre-qualification status. */
export const canMoveLeadStatus = (from: LeadStatus, to: LeadStatus) =>
  from !== to &&
  LEAD_BEFORE_QUALIFICATION.includes(from) &&
  LEAD_STATUS_MOVE_TARGETS.includes(to);

// "SALES_ASSIGNED" -> "Sales Assigned", as the frontend shows statuses.
export const leadStatusLabel = (status: LeadStatus) =>
  status
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

export function assignRefusal(status: LeadStatus): string {
  return LEAD_CLOSED.includes(status)
    ? `This lead is closed (${leadStatusLabel(status)}), so it cannot be assigned to pre-sales.`
    : `This lead has already been qualified (${leadStatusLabel(status)}), so it cannot be assigned to pre-sales.`;
}

export function qualifyRefusal(status: LeadStatus): string {
  return LEAD_CLOSED.includes(status)
    ? `This lead is closed (${leadStatusLabel(status)}), so it cannot be qualified.`
    : `This lead has already been qualified (${leadStatusLabel(status)}).`;
}

export function rejectRefusal(status: LeadStatus): string {
  return status === 'REJECTED'
    ? 'This lead has already been rejected.'
    : `This lead is closed (${leadStatusLabel(status)}), so it cannot be rejected.`;
}

export function reopenRefusal(status: LeadStatus): string {
  return LEAD_CLOSED.includes(status)
    ? `Only a rejected lead can be reopened; this one is ${leadStatusLabel(status)}.`
    : `This lead is open (${leadStatusLabel(status)}); only a rejected lead can be reopened.`;
}

export function statusMoveRefusal(from: LeadStatus, to: LeadStatus): string {
  if (from === to) return `This lead is already ${leadStatusLabel(to)}.`;
  if (!LEAD_STATUS_MOVE_TARGETS.includes(to))
    return `${leadStatusLabel(to)} is not set here: use Assign, Qualify, Reject or the opportunity's stage instead.`;
  return LEAD_CLOSED.includes(from)
    ? `This lead is closed (${leadStatusLabel(from)}); reopen it first.`
    : `This lead has already been qualified (${leadStatusLabel(from)}), so its pre-qualification status cannot be changed.`;
}

export function opportunityRefusal(status: LeadStatus): string {
  return `An opportunity can only be created for a qualified lead; this one is ${leadStatusLabel(status)}.`;
}
