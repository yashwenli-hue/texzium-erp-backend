import { IsNumber, IsString } from 'class-validator';

export class CreateRefundVoucherDto {
  @IsString()
  creditNoteId: string;

  @IsString()
  refundDate: string;

  @IsNumber()
  refundAmount: number;

  @IsString()
  refundMode: string;

  @IsString()
  referenceNo: string;
}
