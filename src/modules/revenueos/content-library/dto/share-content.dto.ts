import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const SHARE_TARGET_TYPES = ['LEAD', 'OPPORTUNITY', 'CUSTOMER'] as const;
export const SHARE_CHANNELS = ['WHATSAPP', 'DOWNLOAD'] as const;
export const SHARE_MESSAGE_MAX = 1000;

export class ShareContentDto {
  @IsIn(SHARE_TARGET_TYPES)
  targetType!: (typeof SHARE_TARGET_TYPES)[number];

  @IsUUID()
  targetId!: string;

  // WHATSAPP: handed to WhatsApp (wa.me) with the file attached by the person;
  // DOWNLOAD: downloaded to send another way.
  @IsIn(SHARE_CHANNELS)
  channel!: (typeof SHARE_CHANNELS)[number];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @IsOptional()
  @Transform(trim)
  @Matches(/^\+?[0-9][0-9 ()-]{5,30}$/, {
    message: 'recipientPhone must be a phone number',
  })
  recipientPhone?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SHARE_MESSAGE_MAX)
  message?: string;
}
