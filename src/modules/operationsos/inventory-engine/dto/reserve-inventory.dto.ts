import {
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsNumber,
} from 'class-validator';

export class ReserveInventoryDto {
  @IsUUID()
  inventoryItemId: string;

  @IsUUID()
  dispatchOrderItemId: string;

  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  binLocation?: string;

  @IsOptional()
  @IsString()
  reservedBy?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
