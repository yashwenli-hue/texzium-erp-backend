import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { SALES_ORDER_REMARKS_MAX_LENGTH } from '../../sales-orders/sales-order-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// The approver is the signed-in user; the request cannot name one (the
// ValidationPipe rejects approvedBy and any other undeclared property).
export class CreateAccountsCommercialApprovalDto {
  @IsUUID()
  salesOrderId: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SALES_ORDER_REMARKS_MAX_LENGTH)
  remarks?: string;
}
