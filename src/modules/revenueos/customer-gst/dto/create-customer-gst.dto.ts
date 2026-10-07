import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  GSTIN_PATTERN,
  GST_ADDRESS_MAX_LENGTH,
  GST_CITY_MAX_LENGTH,
  GST_NAME_MAX_LENGTH,
  PINCODE_PATTERN,
} from '../customer-gst-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// A blank optional field is "not supplied".
const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// POST /customer-gst
//
// The state is not accepted: the server reads it from the GSTIN. Neither are
// the active flag (a new registration is active) nor an id.
export class CreateCustomerGstDto {
  @IsUUID()
  customerId: string;

  @Transform(upper)
  @IsString()
  @Matches(GSTIN_PATTERN, {
    message: 'gstin must be a valid GSTIN, for example 27ABCDE1234F1Z5',
  })
  gstin: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GST_NAME_MAX_LENGTH)
  legalName: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(GST_NAME_MAX_LENGTH)
  tradeName?: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(GST_NAME_MAX_LENGTH)
  branchName?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GST_ADDRESS_MAX_LENGTH)
  addressLine1: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(GST_ADDRESS_MAX_LENGTH)
  addressLine2?: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GST_CITY_MAX_LENGTH)
  city: string;

  @Transform(trim)
  @IsString()
  @Matches(PINCODE_PATTERN, {
    message: 'pincode must be a 6 digit PIN code',
  })
  pincode: string;

  // Make this the customer's default registration. The first registration of a
  // customer is its default whatever is sent.
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
