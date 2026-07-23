import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateInventoryItemDto {
  @IsString()
  sku: string;

  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  stockQty: number;

  @IsOptional()
  @IsNumber()
  reservedQty?: number;

  @IsNumber()
  availableQty: number;

  @IsOptional()
  @IsString()
  warehouse?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  hsnMasterId?: string;

  @IsOptional()
  @IsBoolean()
  warrantyApplicable?: boolean;

  @IsOptional()
  @IsString()
  warrantyPolicyType?: string;

  @IsOptional()
  @IsNumber()
  warrantyMonths?: number;
}
