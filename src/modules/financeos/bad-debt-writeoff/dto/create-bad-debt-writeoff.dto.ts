import { IsNumber, IsString } from 'class-validator';

export class CreateBadDebtWriteOffDto {
  @IsString()
  accountsReceivableId: string;

  @IsString()
  writeOffDate: string;

  @IsNumber()
  writeOffAmount: number;

  @IsString()
  reason: string;

  @IsString()
  approvedBy: string;
}
