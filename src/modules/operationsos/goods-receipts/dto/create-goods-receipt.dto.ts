import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateGoodsReceiptDto {
  @IsUUID()
  purchaseOrderId: string;

  @IsNumber()
  @Min(0.000001)
  receivedQty: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
