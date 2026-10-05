import { LeadActivityType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const LEAD_ACTIVITY_REMARKS_MAX_LENGTH = 2000;

// The actor, source and action code are never accepted from the client: the
// server derives them (actor from the authenticated user), and the global
// ValidationPipe rejects any property that is not declared here.
export class CreateLeadActivityDto {
  @IsEnum(LeadActivityType)
  activityType: LeadActivityType;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEAD_ACTIVITY_REMARKS_MAX_LENGTH)
  remarks: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
