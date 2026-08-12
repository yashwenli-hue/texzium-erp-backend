import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class TransferInventoryDto {
  @IsUUID()
  inventoryItemId: string;

  @IsUUID()
  sourceWarehouseId: string;

  @IsOptional()
  @IsUUID()
  sourceBinId?: string;

  @IsUUID()
  destinationWarehouseId: string;

  @IsOptional()
  @IsUUID()
  destinationBinId?: string;

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

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  transferredBy?: string;
}
