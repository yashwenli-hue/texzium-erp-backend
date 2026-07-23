import {
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePurchaseOrderDto {
  @IsString()
  purchaseRequisitionId: string;

  @IsOptional()
  @IsString()
  poNumber?: string;

  @IsNumber()
  orderQty: number;
}
