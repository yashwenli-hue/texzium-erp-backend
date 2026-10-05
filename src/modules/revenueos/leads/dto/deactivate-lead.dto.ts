import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const LEAD_DEACTIVATION_REASON_MAX_LENGTH = 500;

// The actor is never accepted from the client; it comes from the signed-in
// user, and the ValidationPipe rejects any property not declared here.
export class DeactivateLeadDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(LEAD_DEACTIVATION_REASON_MAX_LENGTH)
  reason: string;
}
