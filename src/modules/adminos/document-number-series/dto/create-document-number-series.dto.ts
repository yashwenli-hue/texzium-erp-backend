import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateDocumentNumberSeriesDto {
  @IsString()
  module: string;

  @IsString()
  documentType: string;

  @IsString()
  seriesName: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  gstRegistrationId?: string;

  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  suffix?: string;

  @IsOptional()
  @IsString()
  separator?: string;

  @IsOptional()
  @IsString()
  financialYearFormat?: string;

  @IsOptional()
  @IsString()
  resetPolicy?: string;

  @IsOptional()
  @IsInt()
  startingNumber?: number;

  @IsOptional()
  @IsInt()
  padding?: number;

  @IsOptional()
  @IsBoolean()
  isManual?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}
