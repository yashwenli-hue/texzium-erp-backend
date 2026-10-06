import { IsIn } from 'class-validator';

import { OPPORTUNITY_STAGES } from '../opportunity-stage';
import type { OpportunityStage } from '../opportunity-stage';

// `fromStage` is the stage the person was looking at. The move only happens if
// the opportunity is still in it, so a stale screen cannot overwrite a newer
// change. The actor is never accepted from the client; it comes from the
// signed-in user, and the ValidationPipe rejects any property not declared here.
export class UpdateOpportunityStageDto {
  @IsIn(OPPORTUNITY_STAGES)
  fromStage: OpportunityStage;

  @IsIn(OPPORTUNITY_STAGES)
  toStage: OpportunityStage;
}
