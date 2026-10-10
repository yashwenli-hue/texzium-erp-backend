import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { OPPORTUNITY_STAGE_REMARK_MAX_LENGTH } from '../../opportunities/opportunity-stage';

// Same limit as the other remarks people write on lead history.
export const LEAD_REJECT_REASON_MAX_LENGTH =
  OPPORTUNITY_STAGE_REMARK_MAX_LENGTH;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Why the lead is rejected: required, and stored as the person's remark on the
// LEAD_REJECTED event, apart from the system's own sentence. The actor is never
// accepted from the client, and the ValidationPipe rejects any property not
// declared here.
export class RejectLeadDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEAD_REJECT_REASON_MAX_LENGTH)
  reason: string;
}
