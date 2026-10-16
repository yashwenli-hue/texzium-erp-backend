import { LeadStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { OPPORTUNITY_STAGE_REMARK_MAX_LENGTH } from '../../opportunities/opportunity-stage';

const blankIsNoRemark = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

// A pre-qualification move (New, Contacted, Underqualified). `status` must be a real
// lead status (400 otherwise); which moves are allowed is decided under the lock (409).
// `expectedStatus` is the status the person saw: when given and the lead has moved on
// since, nothing changes (409). The actor is the authenticated user, never the body.
export class UpdateLeadStatusDto {
  @IsString()
  @IsNotEmpty()
  leadId: string;

  @IsEnum(LeadStatus)
  status: LeadStatus;

  @IsOptional()
  @IsEnum(LeadStatus)
  expectedStatus?: LeadStatus;

  @Transform(blankIsNoRemark)
  @IsOptional()
  @IsString()
  @MaxLength(OPPORTUNITY_STAGE_REMARK_MAX_LENGTH)
  remarks?: string;
}
