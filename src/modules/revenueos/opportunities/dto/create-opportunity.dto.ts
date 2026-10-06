import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const OPPORTUNITY_TITLE_MAX_LENGTH = 200;

export class CreateOpportunityDto {
  @IsUUID()
  leadId: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(OPPORTUNITY_TITLE_MAX_LENGTH)
  title: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  expectedValue: number;

  @IsInt()
  @Min(0)
  @Max(100)
  probability: number;

  @IsISO8601({ strict: true })
  expectedCloseDate: string;
}
