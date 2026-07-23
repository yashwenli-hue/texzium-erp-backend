import { IsString } from 'class-validator';

export class UpdateLeadStatusDto {
  @IsString()
  leadId: string;

  @IsString()
  status: string;
}
