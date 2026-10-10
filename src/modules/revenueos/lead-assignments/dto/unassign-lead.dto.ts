import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { OPPORTUNITY_STAGE_REMARK_MAX_LENGTH } from '../../opportunities/opportunity-stage';

// Same limit as the remark on an opportunity stage change.
export const LEAD_UNASSIGN_REMARK_MAX_LENGTH =
  OPPORTUNITY_STAGE_REMARK_MAX_LENGTH;

// A remark that is blank once trimmed is the same as no remark.
const blankIsNoRemark = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

// `assignedToId` is the assignee the person saw and wants to remove: the lead is
// only unassigned if that is still its assignee, so a stale screen cannot remove a
// newer assignment. `remarks` is what the person says about it, stored on the history
// event apart from the system's own sentence. The actor is never accepted from the
// client, and the ValidationPipe rejects any property not declared here.
export class UnassignLeadDto {
  @IsString()
  @IsNotEmpty()
  assignedToId: string;

  @Transform(blankIsNoRemark)
  @IsOptional()
  @IsString()
  @MaxLength(LEAD_UNASSIGN_REMARK_MAX_LENGTH)
  remarks?: string;
}
