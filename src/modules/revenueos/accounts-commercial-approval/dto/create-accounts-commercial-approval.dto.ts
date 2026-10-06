import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { SALES_ORDER_REMARKS_MAX_LENGTH } from '../../sales-orders/sales-order-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAccountsCommercialApprovalDto {
  @IsUUID()
  salesOrderId: string;

  // TRANSITIONAL: the current service still stores this label in the required
  // approvedBy column. It is not the actor and is removed when the lifecycle
  // service records the signed-in user instead.
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  approvedBy: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SALES_ORDER_REMARKS_MAX_LENGTH)
  remarks?: string;
}
