import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreatePaymentCollectionDto {
  @IsString()
  accountsReceivableId: string;

  @IsString()
  paymentDate: string;

  @IsNumber()
  amount: number;

  @IsString()
  paymentMode: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
