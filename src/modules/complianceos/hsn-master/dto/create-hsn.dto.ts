import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateHsnDto {
  @IsString()
  hsnCode: string;

  @IsString()
  description: string;

  @IsNumber()
  gstRate: number;

  @IsNumber()
  cgstRate: number;

  @IsNumber()
  sgstRate: number;

  @IsNumber()
  igstRate: number;

  @IsOptional()
  @IsNumber()
  cessRate?: number;

  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
