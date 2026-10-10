import { IsNotEmpty, IsString } from 'class-validator';

// The pre-sales user who takes the lead. The actor is never accepted from the
// client, and the ValidationPipe rejects any property not declared here.
export class AssignLeadDto {
  @IsString()
  @IsNotEmpty()
  leadId: string;

  @IsString()
  @IsNotEmpty()
  assignedToId: string;
}
