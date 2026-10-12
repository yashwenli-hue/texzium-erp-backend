import { IsNumber, IsOptional, IsPositive, Max } from 'class-validator';

import { QUOTATION_MAX_TAXABLE_AMOUNT } from '../quotation-values';
import { QuotationRemarksDto } from './quotation-remarks.dto';

// PATCH /quotations/:id/revise
//
// A quotation with a priced line is revised by its unit rate (`unitPrice`); one
// stored before lines existed, by its taxable amount (`taxableAmount`). The
// service accepts exactly the one the quotation needs. GST and the total are
// always worked out by the backend; the request cannot supply them.
export class ReviseQuotationDto extends QuotationRemarksDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(QUOTATION_MAX_TAXABLE_AMOUNT)
  taxableAmount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(QUOTATION_MAX_TAXABLE_AMOUNT)
  unitPrice?: number;
}
