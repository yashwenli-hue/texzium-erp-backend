import { IsISO8601, IsNumber, IsPositive, IsUUID } from 'class-validator';

// `totalAmount` is still accepted from the client in this version; deriving it
// from the approved Proforma Invoice is part of the lifecycle work that follows.
export class CreateSalesOrderDto {
  @IsUUID()
  proformaInvoiceId: string;

  @IsISO8601({ strict: true })
  orderDate: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  totalAmount: number;

  @IsUUID()
  inventoryItemId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  orderQty: number;

  @IsUUID()
  sellerGstId: string;

  @IsUUID()
  buyerGstId: string;
}
