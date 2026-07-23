import { IsNumber, IsString } from 'class-validator';

export class CreateQuotationDto {
  @IsString()
  opportunityId: string;

  @IsString()
  quoteDate: string;

  @IsString()
  inventoryItemId: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsString()
  sellerGstId: string;

  @IsString()
  buyerGstId: string;
}
