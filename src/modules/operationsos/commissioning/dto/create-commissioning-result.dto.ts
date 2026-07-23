import { IsString } from 'class-validator';

export class CreateCommissioningResultDto {
  @IsString()
  commissioningId: string;

  @IsString()
  fieldId: string;

  @IsString()
  fieldValue: string;
}
