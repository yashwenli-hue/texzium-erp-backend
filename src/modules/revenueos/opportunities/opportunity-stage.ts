import { BadRequestException } from '@nestjs/common';

// Opportunity.status holds exactly one of these values.
export const OPPORTUNITY_STAGES = [
  'QUALIFIED',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const INITIAL_OPPORTUNITY_STAGE: OpportunityStage = 'QUALIFIED';

// The optional remark the person writes when they move an opportunity.
export const OPPORTUNITY_STAGE_REMARK_MAX_LENGTH = 500;

const STAGE_LABEL: Record<OpportunityStage, string> = {
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
};

// One step forward, one step back, or Lost from any open stage. Won and Lost
// are final: nothing moves out of them.
export const OPPORTUNITY_STAGE_TRANSITIONS: Record<
  OpportunityStage,
  readonly OpportunityStage[]
> = {
  QUALIFIED: ['PROPOSAL', 'LOST'],
  PROPOSAL: ['NEGOTIATION', 'QUALIFIED', 'LOST'],
  NEGOTIATION: ['WON', 'PROPOSAL', 'LOST'],
  WON: [],
  LOST: [],
};

// A stored value outside the five stages (for example a row that still reads
// OPEN because the migration has not been applied) is shown as it is.
export function opportunityStageLabel(stage: string): string {
  return STAGE_LABEL[stage as OpportunityStage] ?? stage;
}

export function isOpportunityStageTransitionAllowed(
  from: OpportunityStage,
  to: OpportunityStage,
): boolean {
  return OPPORTUNITY_STAGE_TRANSITIONS[from].includes(to);
}

// Pure rule check, independent of what is stored. Whether the stored stage
// still equals `from` is decided separately, atomically, by the update itself.
export function assertOpportunityStageTransition(
  from: OpportunityStage,
  to: OpportunityStage,
): void {
  if (isOpportunityStageTransitionAllowed(from, to)) {
    return;
  }

  if (OPPORTUNITY_STAGE_TRANSITIONS[from].length === 0) {
    throw new BadRequestException(
      `A ${opportunityStageLabel(from)} opportunity is final and can't be moved.`,
    );
  }

  if (from === to) {
    throw new BadRequestException(
      `The opportunity is already in ${opportunityStageLabel(to)}.`,
    );
  }

  throw new BadRequestException(
    `An opportunity can't move from ${opportunityStageLabel(from)} to ${opportunityStageLabel(to)}. ` +
      'Move it one step at a time, or mark it Lost.',
  );
}

export function opportunityStageConflictMessage(current: string): string {
  return (
    `This opportunity's stage has changed (now ${opportunityStageLabel(current)}). ` +
    'Reload and try again.'
  );
}
