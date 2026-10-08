import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';

import {
  IsNotFuturePaymentDate,
  IsRupeeAmount,
  PAYMENT_AMOUNT_MAX,
  PAYMENT_MODES,
  PAYMENT_REFERENCE_MAX_LENGTH,
  PAYMENT_REMARKS_MAX_LENGTH,
  normalizePaymentMode,
} from '../payment-collection-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// A blank optional field is "not supplied".
const optionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
};

// The recorder is never accepted from the client: it comes from the signed-in
// user, and the global ValidationPipe rejects any property not declared here.
export class CreatePaymentCollectionDto {
  @IsUUID()
  salesInvoiceId: string;

  @IsDateString({ strict: true })
  @IsNotFuturePaymentDate()
  paymentDate: string;

  @IsRupeeAmount()
  @Max(PAYMENT_AMOUNT_MAX)
  amountReceived: number;

  @Transform(({ value }) => normalizePaymentMode(value))
  @IsIn(PAYMENT_MODES, {
    message: `paymentMode must be one of: ${PAYMENT_MODES.join(', ')}`,
  })
  paymentMode: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PAYMENT_REFERENCE_MAX_LENGTH)
  referenceNo: string;

  @IsOptional()
  @Transform(optionalText)
  @IsString()
  @MaxLength(PAYMENT_REMARKS_MAX_LENGTH)
  remarks?: string;
}
