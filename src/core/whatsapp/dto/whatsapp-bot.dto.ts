import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateWhatsAppBotConfigDto {
  @IsString()
  @IsNotEmpty()
  whatsappConfigId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  welcomeMessage: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  unknownUserMessage: string;

  @IsOptional()
  @IsBoolean()
  enableCustomerLookup?: boolean;

  @IsOptional()
  @IsBoolean()
  enableLeadCapture?: boolean;

  @IsOptional()
  @IsBoolean()
  enableHumanHandoff?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateWhatsAppDepartmentRouteDto {
  @IsString()
  @IsNotEmpty()
  botConfigId: string;

  @IsInt()
  @Min(1)
  optionNumber: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  departmentName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  routeType: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  roleId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SendWhatsAppMessageDto {
  @IsString()
  @IsNotEmpty()
  configId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  to: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  message: string;
}
