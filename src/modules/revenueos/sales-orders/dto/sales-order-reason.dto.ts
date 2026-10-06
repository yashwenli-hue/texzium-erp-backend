import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { SALES_ORDER_REASON_MAX_LENGTH } from '../sales-order-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// The reason that must accompany every retraction and cancellation: trimmed,
// 1 to 500 characters. It is stored as the lifecycle event's remarks. The
// actor is the signed-in user; the request cannot name one (the
// ValidationPipe rejects actorId and any other undeclared property).
export class SalesOrderReasonDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(SALES_ORDER_REASON_MAX_LENGTH)
  reason: string;
}
