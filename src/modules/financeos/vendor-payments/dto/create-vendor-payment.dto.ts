import { IsDateString, IsNumber, IsString } from 'class-validator';

export class CreateVendorPaymentDto {
  @IsString()
  accountsPayableId: string;

  @IsDateString()
  paymentDate: string;

  @IsNumber()
  amountPaid: number;

  @IsString()
  paymentMode: string;

  @IsString()
  referenceNo: string;
}
