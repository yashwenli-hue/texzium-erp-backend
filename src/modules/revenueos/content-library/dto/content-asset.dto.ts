import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { CONTENT_KINDS } from '../content-types';
import { CONTENT_DISPOSITIONS } from '../content-access';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const CONTENT_TITLE_MAX = 160;
export const CONTENT_DESCRIPTION_MAX = 2000;
export const CONTENT_TAG_MAX = 40;
export const CONTENT_TAGS_MAX = 20;
export const CONTENT_ARCHIVE_REASON_MAX = 500;

// The form fields that come with an upload (multipart/form-data, so every field is
// text; tags are one comma-separated field).
export class CreateContentAssetDto {
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the content a title.' })
  @MaxLength(CONTENT_TITLE_MAX)
  title!: string;

  @IsIn(CONTENT_KINDS, {
    message: `kind must be one of ${CONTENT_KINDS.join(', ')}`,
  })
  kind!: (typeof CONTENT_KINDS)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(CONTENT_DESCRIPTION_MAX)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CONTENT_TAGS_MAX * (CONTENT_TAG_MAX + 2))
  tags?: string;

  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;

  // a finished piecewise upload (POST /content-uploads), instead of a multipart file
  @IsOptional()
  @IsUUID()
  uploadId?: string;
}

export class UpdateContentAssetDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Give the content a title.' })
  @MaxLength(CONTENT_TITLE_MAX)
  title?: string;

  // null clears it
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(CONTENT_DESCRIPTION_MAX)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONTENT_TAGS_MAX)
  @IsString({ each: true })
  @MaxLength(CONTENT_TAG_MAX, { each: true })
  tags?: string[];

  // null clears it
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  inventoryItemId?: string | null;
}

export class ArchiveContentAssetDto {
  @Transform(trim)
  @IsString()
  @MinLength(3, {
    message: 'Say why the content is archived (at least 3 characters).',
  })
  @MaxLength(CONTENT_ARCHIVE_REASON_MAX)
  reason!: string;
}

export class ListContentAssetsQueryDto {
  @IsOptional()
  @IsIn(CONTENT_KINDS)
  kind?: (typeof CONTENT_KINDS)[number];

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED', 'ALL'])
  status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(CONTENT_TAG_MAX)
  tag?: string;

  @IsOptional()
  @IsUUID()
  inventoryItemId?: string;
}

export class ContentAccessUrlDto {
  @IsIn(CONTENT_DISPOSITIONS)
  disposition!: (typeof CONTENT_DISPOSITIONS)[number];

  // a specific version; without it, the current one
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version?: number;
}

export class ContentFileQueryDto {
  @IsOptional()
  @Matches(/^\d{1,12}$/)
  exp?: string;

  @IsOptional()
  @IsIn(CONTENT_DISPOSITIONS)
  disp?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9_-]{1,64}$/)
  sig?: string;
}
