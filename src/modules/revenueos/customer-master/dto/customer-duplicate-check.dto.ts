import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import {
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_NAME_MAX_LENGTH,
} from '../customer-values';

const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

// GET /customers/duplicate-check?customerName=&panNumber=&phone=&email=
//
// Lenient on purpose: this is asked while a person is still typing, so a half
// typed PAN or phone number is a valid question and simply matches nothing.
// At least one field is required.
export class CustomerDuplicateCheckQueryDto {
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  customerName?: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(20)
  panNumber?: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string;

  // The customer being edited, so it is not reported as its own duplicate.
  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(64)
  excludeCustomerId?: string;
}
