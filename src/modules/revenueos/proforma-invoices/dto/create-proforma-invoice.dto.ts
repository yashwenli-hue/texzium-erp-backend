import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateProformaInvoiceDto {
  @IsString()
  quotationId: string;

  @IsString()
  issueDate: string;

  @IsNumber()
  totalAmount: number;

  @IsOptional()
  @IsString()
  validityDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
