import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateVendorBillDto {
  @IsString()
  goodsReceiptId: string;

  @IsString()
  vendorName: string;

  @IsOptional()
  @IsString()
  billNumber?: string;

  @IsDateString()
  billDate: string;

  @IsNumber()
  taxableAmount: number;

  @IsNumber()
  taxAmount: number;

  @IsNumber()
  totalAmount: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
