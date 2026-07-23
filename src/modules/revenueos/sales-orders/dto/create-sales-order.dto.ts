import { IsNumber, IsString } from 'class-validator';

export class CreateSalesOrderDto {
  @IsString()
  proformaInvoiceId: string;

  @IsString()
  orderDate: string;

  @IsNumber()
  totalAmount: number;

  @IsString()
  inventoryItemId: string;

  @IsNumber()
  orderQty: number;

  @IsString()
  sellerGstId: string;

  @IsString()
  buyerGstId: string;
}
