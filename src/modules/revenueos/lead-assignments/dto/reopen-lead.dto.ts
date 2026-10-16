import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { OPPORTUNITY_STAGE_REMARK_MAX_LENGTH } from '../../opportunities/opportunity-stage';

export const LEAD_REOPEN_REASON_MAX_LENGTH =
  OPPORTUNITY_STAGE_REMARK_MAX_LENGTH;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Why a rejected lead is being reopened: required, and stored as the person's remark on
// the LEAD_REOPENED event. The actor is never accepted from the client, and the
// ValidationPipe rejects any property not declared here.
export class ReopenLeadDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEAD_REOPEN_REASON_MAX_LENGTH)
  reason: string;
}
