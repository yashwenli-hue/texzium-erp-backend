import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_TYPE_MAX_LENGTH,
  PAN_PATTERN,
  PHONE_PATTERN,
} from '../customer-values';

// Trims a string; a blank optional field is "not supplied".
const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const optionalUpper = ({ value }: { value: unknown }) => {
  const text = optionalText({ value });

  return typeof text === 'string' ? text.toUpperCase() : text;
};

const optionalLower = ({ value }: { value: unknown }) => {
  const text = optionalText({ value });

  return typeof text === 'string' ? text.toLowerCase() : text;
};

// POST /customers
//
// The customer code is not accepted: the server assigns it (CUST-000001, ...)
// and it never changes. The vendor link and the active flag are not accepted
// either; a new customer is always active.
export class CreateCustomerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  customerName: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(CUSTOMER_TYPE_MAX_LENGTH)
  customerType?: string;

  @IsOptional()
  @Transform(optionalUpper)
  @IsString()
  @Matches(PAN_PATTERN, {
    message: 'panNumber must be a valid PAN, for example ABCDE1234F',
  })
  panNumber?: string;

  @IsOptional()
  @Transform(optionalLower)
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be a valid phone number (7 to 20 digits)',
  })
  phone?: string;
}
