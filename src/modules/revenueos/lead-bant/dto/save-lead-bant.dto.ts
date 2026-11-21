import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { BANT_OPTION_VALUES } from '../bant-questions';

// PUT /leads/:id/bant. Saves what is answered so far: a question may be left empty
// (null or absent) and answered later. Each answer is one of its question's option
// values; each note is optional free text. The score is always worked out by the
// server, never taken from the client.
export class SaveLeadBantDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(BANT_OPTION_VALUES.budget as string[])
  budget?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(BANT_OPTION_VALUES.authority as string[])
  authority?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(BANT_OPTION_VALUES.need as string[])
  need?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(BANT_OPTION_VALUES.timeline as string[])
  timeline?: string | null;

  /** The budget figure, in rupees, when the customer gave one. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  budgetAmount?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  budgetNote?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  authorityNote?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  needNote?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  timelineNote?: string | null;
}
