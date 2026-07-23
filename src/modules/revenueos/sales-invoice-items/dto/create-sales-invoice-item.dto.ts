import { IsNumber, IsString } from 'class-validator';

export class CreateSalesInvoiceItemDto {
  @IsString()
  salesInvoiceId: string;

  @IsString()
  productId: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  rate: number;

  @IsNumber()
  taxableAmount: number;

  @IsNumber()
  gstAmount: number;

  @IsNumber()
  totalAmount: number;
}
