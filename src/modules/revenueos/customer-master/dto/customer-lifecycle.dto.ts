import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

import { CUSTOMER_REASON_MAX_LENGTH } from '../customer-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

// PATCH /customers/:id/deactivate
//
// The reason is mandatory: trimmed, 1 to 500 characters. It is stored as the
// current deactivation reason and as the event's remarks.
export class DeactivateCustomerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  reason: string;
}

// PATCH /customers/:id/reactivate
//
// Remarks are optional.
export class ReactivateCustomerDto {
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(CUSTOMER_REASON_MAX_LENGTH)
  remarks?: string;
}
