import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import {
  ADVANCE_RECEIPT_VERIFICATION_OUTCOMES,
  SALES_ORDER_REMARKS_MAX_LENGTH,
} from '../../sales-orders/sales-order-values';
import type { AdvanceReceiptVerificationOutcome } from '../../sales-orders/sales-order-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// The verifier is the signed-in user; the request cannot name one (the
// ValidationPipe rejects verifiedBy and any other undeclared property).
export class VerifySalesOrderAdvanceReceiptDto {
  // The only outcomes a verification can have.
  @IsIn(ADVANCE_RECEIPT_VERIFICATION_OUTCOMES)
  verificationStatus: AdvanceReceiptVerificationOutcome;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SALES_ORDER_REMARKS_MAX_LENGTH)
  remarks?: string;
}
