import { IsOptional, IsString } from 'class-validator';

export class CreateConnectorDto {
  @IsString()
  name: string;

  @IsString()
  platform: string;

  @IsString()
  connectorType: string;

  @IsOptional()
  @IsString()
  baseUrl?: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  apiSecret?: string;

  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @IsOptional()
  @IsString()
  syncFrequency?: string;
}
