import { Transform } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
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

  // The customer the deal is for. Optional: an opportunity can be created
  // first and linked later. It can also be linked later with
  // PATCH /opportunities/:id/customer.
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
