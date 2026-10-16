import { UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

const blankIsNone = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t === '' ? undefined : t;
};

// PATCH /users/:id/status — ACTIVE, INACTIVE or SUSPENDED, with an optional reason that
// is kept in the audit log.
export class ChangeUserStatusDto {
  @IsEnum(UserStatus)
  status: UserStatus;

  @Transform(blankIsNone)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
