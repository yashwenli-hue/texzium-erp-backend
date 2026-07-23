import { IsOptional, IsString } from 'class-validator';

export class CreateAssetDto {
  @IsString()
  serialNumber: string;

  @IsString()
  salesInvoiceId: string;

  @IsString()
  productName: string;

  @IsOptional()
  @IsString()
  installationDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
