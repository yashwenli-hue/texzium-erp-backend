import { Transform } from 'class-transformer';
import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { PROFORMA_REMARKS_MAX_LENGTH } from '../proforma-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// POST /proforma-invoices
//
// The Proforma's total is always its APPROVED Quotation's. A client may still
// send `totalAmount` (older screens do), but it is never stored: it is only
// checked against the Quotation's and refused when it differs.
export class CreateProformaInvoiceDto {
  @IsUUID()
  quotationId: string;

  @IsISO8601({ strict: true })
  issueDate: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  totalAmount?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  validityDate?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(PROFORMA_REMARKS_MAX_LENGTH)
  remarks?: string;
}
