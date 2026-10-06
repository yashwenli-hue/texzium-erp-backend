import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  SALES_ORDER_PAYMENT_MODES,
  SALES_ORDER_REFERENCE_MAX_LENGTH,
  SALES_ORDER_REMARKS_MAX_LENGTH,
} from '../../sales-orders/sales-order-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSalesOrderAdvanceReceiptDto {
  @IsUUID()
  salesOrderId: string;

  @IsISO8601({ strict: true })
  receiptDate: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  amountReceived: number;

  @IsIn(SALES_ORDER_PAYMENT_MODES)
  paymentMode: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SALES_ORDER_REFERENCE_MAX_LENGTH)
  referenceNo?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SALES_ORDER_REMARKS_MAX_LENGTH)
  remarks?: string;
}
