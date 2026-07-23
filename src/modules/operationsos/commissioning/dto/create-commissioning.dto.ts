import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCommissioningDto {
  @IsString()
  installationId: string;

  @IsString()
  templateId: string;

  @IsString()
  engineerName: string;

  @IsDateString()
  commissioningDate: string;

  @IsOptional()
  @IsBoolean()
  customerAccepted?: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}
