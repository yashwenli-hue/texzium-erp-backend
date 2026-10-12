import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CONTENT_MAX_UPLOAD_BYTES } from '../content-types';

export class StartUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONTENT_MAX_UPLOAD_BYTES)
  sizeBytes!: number;
}

export class ChunkQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(CONTENT_MAX_UPLOAD_BYTES)
  offset!: number;
}

// A new version from a finished piecewise upload (instead of a multipart file).
export class AddVersionDto {
  @IsOptional()
  @IsUUID()
  uploadId?: string;
}
