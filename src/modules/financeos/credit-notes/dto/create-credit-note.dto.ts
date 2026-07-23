import { IsNumber, IsString } from 'class-validator';

export class CreateCreditNoteDto {
  @IsString()
  salesInvoiceId: string;

  @IsString()
  noteDate: string;

  @IsString()
  reason: string;

  @IsNumber()
  taxableAmount: number;

  @IsNumber()
  gstAmount: number;

  @IsNumber()
  totalAmount: number;
}
