import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

// PUT /document-profile
//
// Every field is optional: a field left out keeps its value, null or an empty
// string clears it. Text is trimmed. The logo has its own route
// (PUT/DELETE /document-profile/logo), so a logo and long terms never have to
// fit in one request body.

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const digits = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, '') : value;

// 64 KB: its base64 form (about 88 KB) fits the API's 100 KB request limit.
export const LOGO_MAX_BYTES = 64 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg'] as const;

// PUT /document-profile/logo
export class DocumentLogoDto {
  @IsIn(LOGO_TYPES)
  mimeType: (typeof LOGO_TYPES)[number];

  // the file as base64 (checked again, with the image itself, by the service)
  @IsString()
  @MaxLength(Math.ceil(LOGO_MAX_BYTES / 3) * 4 + 4)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/, { message: 'base64 must be base64' })
  base64: string;
}

export class UpdateDocumentProfileDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  registeredOfficeAddress?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankAccountName?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankName?: string | null;

  @Transform(digits)
  @IsOptional()
  @Matches(/^(\d{9,18})?$/, {
    message: 'bankAccountNumber must be 9 to 18 digits',
  })
  bankAccountNumber?: string | null;

  @Transform(trimUpper)
  @IsOptional()
  @Matches(/^([A-Z]{4}0[A-Z0-9]{6})?$/, {
    message: 'bankIfsc must be an IFSC code (e.g. HDFC0001234)',
  })
  bankIfsc?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  bankBranch?: string | null;

  @Transform(trim)
  @IsOptional()
  @Matches(/^([A-Za-z0-9._-]{2,256}@[A-Za-z]{2,64})?$/, {
    message: 'upiId must be a UPI id (e.g. texzium@hdfcbank)',
  })
  upiId?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  quotationTerms?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  proformaTerms?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  invoiceTerms?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  receiptNote?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  signatoryName?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  signatoryDesignation?: string | null;
}
