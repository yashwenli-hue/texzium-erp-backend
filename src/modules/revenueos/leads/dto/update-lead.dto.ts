import {
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @IsUUID()
  sourceId?: string;
}
