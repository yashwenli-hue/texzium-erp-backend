import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { QUOTATION_REMARKS_MAX_LENGTH } from '../quotation-values';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Optional remarks on a lifecycle action. The actor is the signed-in user; the
// request cannot name one (the ValidationPipe rejects actorId and any other
// undeclared property).
export class QuotationRemarksDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(QUOTATION_REMARKS_MAX_LENGTH)
  remarks?: string;
}
