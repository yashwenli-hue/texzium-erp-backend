import { LeadActivityType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const LEAD_ACTIVITY_REMARKS_MAX_LENGTH = 2000;

// What a call came to. NOT_CONNECTED is a call that did not connect ("CNC": no
// answer, busy, switched off, unreachable). Only a CALL has an outcome.
export const CALL_OUTCOMES = ['CONNECTED', 'NOT_CONNECTED'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

const blankIsNone = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

// The actor, source and action code are never accepted from the client: the
// server derives them (actor from the authenticated user), and the global
// ValidationPipe rejects any property that is not declared here.
//
// Remarks are optional for a call with an outcome (a "CNC" is often just that) and
// required otherwise; the service enforces the pairing (400).
export class CreateLeadActivityDto {
  @IsEnum(LeadActivityType)
  activityType: LeadActivityType;

  @Transform(blankIsNone)
  @IsOptional()
  @IsString()
  @MaxLength(LEAD_ACTIVITY_REMARKS_MAX_LENGTH)
  remarks?: string;

  @IsOptional()
  @IsIn(CALL_OUTCOMES)
  outcome?: CallOutcome;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
