import { IsOptional, IsString } from 'class-validator';

export class CreateSalesInvoiceDto {
  @IsString()
  salesOrderId: string;

  @IsString()
  dispatchOrderId: string;

  @IsString()
  invoiceDate: string;

  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
