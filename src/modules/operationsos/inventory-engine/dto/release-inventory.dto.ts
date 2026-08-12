import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class ReleaseInventoryDto {
  @IsUUID()
  inventoryItemId: string;

  @IsUUID()
  dispatchOrderItemId: string;

  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsOptional()
  @IsString()
  releasedBy?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
