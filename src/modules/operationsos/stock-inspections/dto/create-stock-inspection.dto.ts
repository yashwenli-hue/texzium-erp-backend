import { IsOptional, IsString } from 'class-validator';

export class CreateStockInspectionDto {
  @IsString()
  inventoryItemId: string;

  @IsString()
  salesOrderId: string;

  @IsString()
  inspectionDate: string;

  @IsString()
  conditionStatus: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
