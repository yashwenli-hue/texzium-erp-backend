import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DELETION_ENTITY, DELETION_STATUS } from '../data-deletion';

// Reading the deletion log / recycle bin: newest first, optionally one kind of record,
// one status or one original id, and paged.
export class ListDeletionsQueryDto {
  @IsOptional()
  @IsIn(Object.values(DELETION_ENTITY))
  entityType?: (typeof DELETION_ENTITY)[keyof typeof DELETION_ENTITY];

  @IsOptional()
  @IsIn(Object.values(DELETION_STATUS))
  status?: (typeof DELETION_STATUS)[keyof typeof DELETION_STATUS];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === undefined || value === '' ? undefined : Number(value),
  )
  @IsInt()
  @Min(0)
  offset?: number;
}
