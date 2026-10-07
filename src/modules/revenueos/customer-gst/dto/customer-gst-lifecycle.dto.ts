import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { GST_REASON_MAX_LENGTH } from '../customer-gst-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

// PATCH /customer-gst/:id/deactivate
//
// The reason is mandatory: trimmed, 1 to 500 characters. It is stored as the
// event's remarks.
export class DeactivateCustomerGstDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GST_REASON_MAX_LENGTH)
  reason: string;
}

// PATCH /customer-gst/:id/reactivate
//
// Remarks are optional.
export class ReactivateCustomerGstDto {
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(GST_REASON_MAX_LENGTH)
  remarks?: string;
}
