import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class IssueInventoryDto {
  @IsUUID()
  inventoryItemId: string;

  @IsUUID()
  dispatchOrderItemId: string;

  @IsUUID()
  warehouseId: string;

  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsOptional()
  @IsString()
  issuedBy?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
