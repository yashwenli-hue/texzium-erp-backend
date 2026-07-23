import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateInventoryDto {
  @IsString()
  sku: string;

  @IsString()
  productName: string;

  @IsString()
  category: string;

  @IsNumber()
  stockQty: number;

  @IsNumber()
  reservedQty: number;

  @IsNumber()
  availableQty: number;

  @IsString()
  warehouse: string;

  @IsString()
  condition: string;

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
