import {
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateGoodsReceiptDto {
  @IsString()
  purchaseOrderId: string;

  @IsOptional()
  @IsString()
  grnNumber?: string;

  @IsNumber()
  receivedQty: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
