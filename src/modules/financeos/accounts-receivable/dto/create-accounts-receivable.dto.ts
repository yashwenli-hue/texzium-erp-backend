import { IsNumber, IsString } from 'class-validator';

export class CreateAccountsReceivableDto {
  @IsString()
  salesInvoiceId: string;

  @IsString()
  dueDate: string;

  @IsNumber()
  outstandingAmount: number;
}
