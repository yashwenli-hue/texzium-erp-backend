import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  CUSTOMER_EMAIL_MAX_LENGTH,
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_TYPE_MAX_LENGTH,
  PAN_PATTERN,
  PHONE_PATTERN,
} from '../customer-values';

// For an edit, a field that is left out is unchanged and a field that is sent
// blank (or null) is cleared. The name cannot be cleared.
const clearable = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
};

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const clearableUpper = ({ value }: { value: unknown }) => {
  const text = clearable({ value });

  return typeof text === 'string' ? text.toUpperCase() : text;
};

const clearableLower = ({ value }: { value: unknown }) => {
  const text = clearable({ value });

  return typeof text === 'string' ? text.toLowerCase() : text;
};

// PATCH /customers/:id
//
// Only the five editable fields are accepted. The customer code, the
// lifecycle and the vendor link cannot be edited. An edit that sends nothing,
// or only the values already stored, changes nothing and records nothing.
export class UpdateCustomerDto {
  @ValidateIf((o: UpdateCustomerDto) => o.customerName !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(CUSTOMER_NAME_MAX_LENGTH)
  customerName?: string;

  @IsOptional()
  @Transform(clearable)
  @IsString()
  @MaxLength(CUSTOMER_TYPE_MAX_LENGTH)
  customerType?: string | null;

  @IsOptional()
  @Transform(clearableUpper)
  @IsString()
  @Matches(PAN_PATTERN, {
    message: 'panNumber must be a valid PAN, for example ABCDE1234F',
  })
  panNumber?: string | null;

  @IsOptional()
  @Transform(clearableLower)
  @IsEmail()
  @MaxLength(CUSTOMER_EMAIL_MAX_LENGTH)
  email?: string | null;

  @IsOptional()
  @Transform(clearable)
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phone must be a valid phone number (7 to 20 digits)',
  })
  phone?: string | null;
}
