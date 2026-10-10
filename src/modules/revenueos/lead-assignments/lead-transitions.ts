import { LeadStatus } from '@prisma/client';

// Which lead statuses the assignment actions may start from. Enforced here, in the
// backend, under the lock on the lead; the frontend only mirrors these rules.
//
//   before qualification   NEW, ASSIGNED, CONTACTED, PRE_SALES_ASSIGNED
//   qualified / in sales   QUALIFIED, SALES_ASSIGNED, PROPOSAL_SENT, NEGOTIATION
//   closed                 WON, LOST, REJECTED
//
//   assign  -> PRE_SALES_ASSIGNED   from before qualification (from PRE_SALES_ASSIGNED
//                                   only to a different user: a reassignment)
//   qualify -> SALES_ASSIGNED       from before qualification
//   reject  -> REJECTED             from before qualification or qualified / in sales
//
// Everything else is refused with 409. POST /lead-status can still set any status;
// that endpoint is a separate follow-up and does not go through these rules.

export const LEAD_BEFORE_QUALIFICATION: readonly LeadStatus[] = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'PRE_SALES_ASSIGNED',
];

export const LEAD_QUALIFIED_OR_IN_SALES: readonly LeadStatus[] = [
  'QUALIFIED',
  'SALES_ASSIGNED',
  'PROPOSAL_SENT',
  'NEGOTIATION',
];

export const LEAD_CLOSED: readonly LeadStatus[] = ['WON', 'LOST', 'REJECTED'];

export const canAssignLeadFrom = (status: LeadStatus) =>
  LEAD_BEFORE_QUALIFICATION.includes(status);

export const canQualifyLeadFrom = (status: LeadStatus) =>
  LEAD_BEFORE_QUALIFICATION.includes(status);

export const canRejectLeadFrom = (status: LeadStatus) =>
  !LEAD_CLOSED.includes(status);

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
