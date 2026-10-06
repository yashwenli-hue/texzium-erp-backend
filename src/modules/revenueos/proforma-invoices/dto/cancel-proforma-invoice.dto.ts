import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { PROFORMA_REASON_MAX_LENGTH } from '../proforma-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// PATCH /proforma-invoices/:id/cancel
//
// The reason is mandatory: trimmed, 1 to 500 characters. It is stored as the
// lifecycle event's remarks.
export class CancelProformaInvoiceDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PROFORMA_REASON_MAX_LENGTH)
  reason: string;
}
