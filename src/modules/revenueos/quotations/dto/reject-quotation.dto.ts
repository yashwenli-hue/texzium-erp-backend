import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { QUOTATION_REASON_MAX_LENGTH } from '../quotation-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// PATCH /quotations/:id/reject
//
// The reason is mandatory: trimmed, 1 to 500 characters. It is stored as the
// lifecycle event's remarks.
export class RejectQuotationDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUOTATION_REASON_MAX_LENGTH)
  reason: string;
}
