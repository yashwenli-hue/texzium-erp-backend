import { IsNumber, IsString } from 'class-validator';

export class CreateSalesInvoiceDto {
  @IsString()
  salesOrderId: string;

  @IsString()
  invoiceDate: string;

  @IsNumber()
  taxableAmount: number;

  @IsNumber()
  gstPercentage: number;
}
