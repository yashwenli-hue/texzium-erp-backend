import { IsString } from 'class-validator';

export class UpdateQuotationStatusDto {
  @IsString()
  status: string;
}
