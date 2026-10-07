import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  GST_ADDRESS_MAX_LENGTH,
  GST_CITY_MAX_LENGTH,
  GST_NAME_MAX_LENGTH,
  PINCODE_PATTERN,
} from '../customer-gst-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// For an edit, a field that is left out is unchanged and an optional field
// that is sent blank (or null) is cleared.
const clearable = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? null : trimmed;
};

// PATCH /customer-gst/:id
//
// Only the details of the registration can be edited. The GSTIN and the state
// cannot: a registration is identified by its GSTIN, so a different one is a
// new registration. An edit that sends nothing, or only the values already
// stored, changes nothing and records nothing.
export class UpdateCustomerGstDto {
  @ValidateIf((o: UpdateCustomerGstDto) => o.legalName !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GST_NAME_MAX_LENGTH)
  legalName?: string;

  @IsOptional()
  @Transform(clearable)
  @IsString()
  @MaxLength(GST_NAME_MAX_LENGTH)
  tradeName?: string | null;

  @IsOptional()
  @Transform(clearable)
  @IsString()
  @MaxLength(GST_NAME_MAX_LENGTH)
  branchName?: string | null;

  @ValidateIf((o: UpdateCustomerGstDto) => o.addressLine1 !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GST_ADDRESS_MAX_LENGTH)
  addressLine1?: string;

  @IsOptional()
  @Transform(clearable)
  @IsString()
  @MaxLength(GST_ADDRESS_MAX_LENGTH)
  addressLine2?: string | null;

  @ValidateIf((o: UpdateCustomerGstDto) => o.city !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(GST_CITY_MAX_LENGTH)
  city?: string;

  @ValidateIf((o: UpdateCustomerGstDto) => o.pincode !== undefined)
  @Transform(trim)
  @IsString()
  @Matches(PINCODE_PATTERN, {
    message: 'pincode must be a 6 digit PIN code',
  })
  pincode?: string;
}
