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

export class CreateLeadDto {
  @IsOptional()
  @IsString()
  leadCode?: string;

  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsUUID()
  sourceId: string;

  // The product or machine the enquiry is about: an existing inventory item, when known.
  @IsOptional()
  @IsUUID()
  inventoryItemId?: string | null;

  // Location is optional here (leads that arrive without one stay valid); the
  // rules that tie the three fields together are in lead-location.ts.
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
