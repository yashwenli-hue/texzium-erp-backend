import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { COLLECTIONS_LIST_MAX_LIMIT } from '../payment-collection-values';

export class ListPaymentCollectionsQueryDto {
  @IsOptional()
  @IsUUID()
  salesInvoiceId?: string;

  @IsOptional()
  @IsUUID()
  accountsReceivableId?: string;

  // Payment date range, both ends inclusive.
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COLLECTIONS_LIST_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
