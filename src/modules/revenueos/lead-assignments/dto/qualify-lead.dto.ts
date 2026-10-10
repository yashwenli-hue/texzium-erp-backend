import { IsNotEmpty, IsString } from 'class-validator';

// The sales user who takes the qualified lead. The actor is never accepted from the
// client, and the ValidationPipe rejects any property not declared here.
export class QualifyLeadDto {
  @IsString()
  @IsNotEmpty()
  salesUserId: string;
}
