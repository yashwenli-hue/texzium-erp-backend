import { IsString } from 'class-validator';

export class AssignLeadDto {
  @IsString()
  leadId: string;

  @IsString()
  assignedToId: string;
}
