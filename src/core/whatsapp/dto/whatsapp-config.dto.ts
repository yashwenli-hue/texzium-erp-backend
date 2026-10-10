import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Only these fields are accepted (the global ValidationPipe rejects anything else,
// including nested relation objects).

export class CreateWhatsAppConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  whatsappNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  defaultSenderName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  phoneNumberId: string;

  // Write-only: stored server-side and never returned.
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  accessToken: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  businessAccount: string;

  // Write-only: the verify token for Meta's webhook handshake.
  @IsOptional()
  @IsString()
  @MaxLength(512)
  webhookToken?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// Every field is optional. For accessToken and webhookToken, leaving the field out
// or sending an empty string keeps the stored value: the browser never needs to
// know it.
export class UpdateWhatsAppConfigDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  whatsappNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  defaultSenderName?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  accessToken?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  businessAccount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  webhookToken?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
