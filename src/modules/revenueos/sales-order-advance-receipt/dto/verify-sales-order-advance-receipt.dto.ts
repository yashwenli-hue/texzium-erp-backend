import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  ADVANCE_RECEIPT_VERIFICATION_OUTCOMES,
  SALES_ORDER_REMARKS_MAX_LENGTH,
} from '../../sales-orders/sales-order-values';
import type { AdvanceReceiptVerificationOutcome } from '../../sales-orders/sales-order-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class VerifySalesOrderAdvanceReceiptDto {
  // The only outcomes a verification can have.
  @IsIn(ADVANCE_RECEIPT_VERIFICATION_OUTCOMES)
  verificationStatus: AdvanceReceiptVerificationOutcome;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SALES_ORDER_REMARKS_MAX_LENGTH)
  remarks?: string;

  // TRANSITIONAL: a free-text label the current service still writes to the
  // receipt. It is not the actor and is removed when the lifecycle service
  // records the signed-in user instead.
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  verifiedBy?: string;
}
