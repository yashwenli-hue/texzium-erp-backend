import { IsNumber, IsPositive, Max } from 'class-validator';

import { QUOTATION_MAX_TAXABLE_AMOUNT } from '../quotation-values';
import { QuotationRemarksDto } from './quotation-remarks.dto';

// PATCH /quotations/:id/revise
//
// Only the taxable amount can be revised. GST and the total are worked out by
// the backend from the percentage the quotation already carries; the request
// cannot supply them.
export class ReviseQuotationDto extends QuotationRemarksDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(QUOTATION_MAX_TAXABLE_AMOUNT)
  taxableAmount: number;
}
