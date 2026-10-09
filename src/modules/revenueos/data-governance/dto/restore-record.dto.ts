import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// What a restore request may carry: the token the restore preview returned. The restore
// is refused (409) if the record or what it depends on has changed since. The actor is
// never accepted from the client.
export class RestoreRecordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  version: string;
}
