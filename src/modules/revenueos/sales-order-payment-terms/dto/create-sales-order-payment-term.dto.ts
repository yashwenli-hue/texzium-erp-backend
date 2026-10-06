import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

import {
  SALES_ORDER_PAYMENT_TYPES,
  SALES_ORDER_REMARKS_MAX_LENGTH,
} from '../../sales-orders/sales-order-values';

export class CreateSalesOrderPaymentTermDto {
  @IsUUID()
  salesOrderId: string;

  @IsIn(SALES_ORDER_PAYMENT_TYPES)
  paymentType: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  advanceAmount: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  balanceAmount: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  creditDays?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  dueDate?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(SALES_ORDER_REMARKS_MAX_LENGTH)
  remarks?: string;
}
