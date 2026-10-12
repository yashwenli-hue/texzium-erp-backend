import { IsISO8601, IsNumber, IsPositive, IsString } from 'class-validator';

// POST /quotations
//
// The client names the item and supplies the quantity and the unit rate; the
// backend works out the taxable amount, GST (at the item's HSN rate), its split
// and the total, and stores them on the quotation and its line.
export class CreateQuotationDto {
  @IsString()
  opportunityId: string;

  @IsISO8601({ strict: true })
  quoteDate: string;

  @IsString()
  inventoryItemId: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  unitPrice: number;

  @IsString()
  sellerGstId: string;

  @IsString()
  buyerGstId: string;
}
