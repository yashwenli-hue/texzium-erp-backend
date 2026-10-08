import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  OPPORTUNITY_STAGES,
  OPPORTUNITY_STAGE_REMARK_MAX_LENGTH,
} from '../opportunity-stage';
import type { OpportunityStage } from '../opportunity-stage';

// A remark that is blank once trimmed is the same as no remark.
const blankIsNoRemark = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

// `fromStage` is the stage the person was looking at. The move only happens if
// the opportunity is still in it, so a stale screen cannot overwrite a newer
// change. `remarks` is what the person says about the move; it is stored on the
// history event apart from the system's own sentence. The actor is never
// accepted from the client; it comes from the signed-in user, and the
// ValidationPipe rejects any property not declared here.
export class UpdateOpportunityStageDto {
  @IsIn(OPPORTUNITY_STAGES)
  fromStage: OpportunityStage;

  @IsIn(OPPORTUNITY_STAGES)
  toStage: OpportunityStage;

  @Transform(blankIsNoRemark)
  @IsOptional()
  @IsString()
  @MaxLength(OPPORTUNITY_STAGE_REMARK_MAX_LENGTH)
  remarks?: string;
}
