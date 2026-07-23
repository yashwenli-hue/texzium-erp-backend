import { IsString } from 'class-validator';

export class CreateWarrantyDto {
  @IsString()
  salesInvoiceId: string;

  @IsString()
  serialNumber: string;

  @IsString()
  warrantyStart: string;

  @IsString()
  warrantyEnd: string;

  @IsString()
  remarks?: string;
}
