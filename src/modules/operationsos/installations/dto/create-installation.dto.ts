import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateInstallationDto {
  @IsString()
  assetId: string;

  @IsDateString()
  installationDate: string;

  @IsString()
  engineerName: string;

  @IsString()
  siteReadiness: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsBoolean()
  trainingCompleted?: boolean;

  @IsOptional()
  @IsBoolean()
  customerSignoff?: boolean;
}
