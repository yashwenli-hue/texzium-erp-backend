import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  LEAD_CITY_MAX_LENGTH,
  LEAD_COUNTRY_CODES,
  LEAD_INDIA_STATES,
  LEAD_LOCATION_MESSAGE,
  normalizeCityInput,
  normalizeCountryInput,
  normalizeStateInput,
} from '../lead-location';

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;

  // The product or machine the enquiry is about; null clears it.
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string | null;

  // A field that is absent keeps what is stored; null (or blank) clears it. The
  // service checks the location as a whole after applying the change, so moving a
  // lead out of India must clear the state in the same request.
  @Transform(({ value }: { value: unknown }) => normalizeCountryInput(value))
  @IsOptional()
  @IsString()
  @IsIn(LEAD_COUNTRY_CODES, { message: LEAD_LOCATION_MESSAGE.COUNTRY_UNKNOWN })
  country?: string | null;

  @Transform(({ value }: { value: unknown }) => normalizeStateInput(value))
  @IsOptional()
  @IsString()
  @IsIn(LEAD_INDIA_STATES, { message: LEAD_LOCATION_MESSAGE.STATE_UNKNOWN })
  state?: string | null;

  @Transform(({ value }: { value: unknown }) => normalizeCityInput(value))
  @IsOptional()
  @IsString()
  @MaxLength(LEAD_CITY_MAX_LENGTH)
  city?: string | null;
}
