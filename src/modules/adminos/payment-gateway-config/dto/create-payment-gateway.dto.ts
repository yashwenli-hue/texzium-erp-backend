import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreatePaymentGatewayDto {
  @IsString()
  gatewayName: string;

  @IsString()
  gatewayType: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  secretKey?: string;

  @IsOptional()
  @IsString()
  merchantId?: string;

  @IsOptional()
  @IsString()
  upiId?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  accountName?: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsOptional()
  @IsString()
  ifscCode?: string;

  @IsBoolean()
  isActive: boolean;
}
