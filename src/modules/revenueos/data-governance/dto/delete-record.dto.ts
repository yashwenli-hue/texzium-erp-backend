import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  DELETION_REASON_CODES,
  DELETION_REASON_MAX_LENGTH,
} from '../data-deletion';

// What a deletion request may carry. The actor is never accepted from the client; it
// comes from the signed-in user, and the ValidationPipe rejects any property not
// declared here.
//
//   reasonCode      one of the five codes
//   reason          the person's own explanation, 1 to 500 characters once trimmed
//   duplicateOfId   for DUPLICATE only: the record that survives
//   version         the token the preview returned; the deletion is refused (409)
//                   if the record has changed since
export class DeleteRecordDto {
  @IsIn(DELETION_REASON_CODES)
  reasonCode: (typeof DELETION_REASON_CODES)[number];

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(DELETION_REASON_MAX_LENGTH)
  reason: string;

  @IsOptional()
  @IsUUID()
  duplicateOfId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  version: string;
}
