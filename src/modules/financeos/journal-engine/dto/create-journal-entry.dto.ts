import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateJournalEntryDto {
  @IsDateString()
  entryDate: string;

  @IsString()
  voucherNumber: string;

  @IsString()
  accountName: string;

  @IsString()
  entryType: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}
