import {
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
} from 'class-validator';

// The order's total always comes from the approved Proforma Invoice. A
// client may still send `totalAmount` (older screens do), but it is never stored:
// it is only checked against the Proforma's and refused when it differs.
export class CreateSalesOrderDto {
  @IsUUID()
  proformaInvoiceId: string;

  @IsISO8601({ strict: true })
  orderDate: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  totalAmount?: number;

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
