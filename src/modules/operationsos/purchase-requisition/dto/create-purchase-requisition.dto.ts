import {
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreatePurchaseRequisitionDto {
  @IsString()
  salesOrderId: string;

  @IsString()
  inventoryItemId: string;

  @IsNumber()
  requestedQty: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
