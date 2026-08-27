import {
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateLeadDto {
  @IsOptional()
  @IsString()
  leadCode?: string;

  @IsString()
  customerName: string;

  @IsOptional()
  @IsString()
  companyName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsUUID()
  sourceId: string;
}
