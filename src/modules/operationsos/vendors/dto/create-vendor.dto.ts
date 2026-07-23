import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateVendorDto {
  @IsString()
  vendorCode: string;

  @IsString()
  vendorName: string;

  @IsOptional()
  @IsString()
  panNumber?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isCustomer?: boolean;
}
