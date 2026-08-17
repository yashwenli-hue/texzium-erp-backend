import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateSpareConsumptionDto {
  @IsUUID()
  engineerVisitId: string;

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
  quantityUsed: number;

  @IsNumber()
  @Min(0)
  unitCost: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
