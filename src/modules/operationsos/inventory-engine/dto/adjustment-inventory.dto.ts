import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class AdjustmentInventoryDto {
  @IsUUID()
  inventoryItemId: string;

  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsUUID()
  warehouseBinId?: string;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  serialId?: string;

  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @IsIn(['IN', 'OUT'])
  adjustmentType: 'IN' | 'OUT';

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  adjustedBy?: string;
}
