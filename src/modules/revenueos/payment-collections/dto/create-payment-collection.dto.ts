import { IsNumber, IsString } from 'class-validator';

export class CreatePaymentCollectionDto {
  @IsString()
  salesInvoiceId: string;

  @IsString()
  paymentDate: string;

  @IsNumber()
  amountReceived: number;

  @IsString()
  paymentMode: string;

  @IsString()
  referenceNo: string;
}
