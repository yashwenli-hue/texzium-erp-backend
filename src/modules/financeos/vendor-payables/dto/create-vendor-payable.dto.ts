import { IsDateString, IsNumber, IsString } from 'class-validator';

export class CreateVendorPayableDto {
  @IsString()
  vendorBillId: string;

  @IsString()
  vendorName: string;

  @IsDateString()
  dueDate: string;

  @IsNumber()
  outstandingAmount: number;
}
