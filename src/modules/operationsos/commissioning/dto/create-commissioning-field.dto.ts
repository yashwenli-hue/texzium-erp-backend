import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCommissioningFieldDto {
  @IsString()
  templateId: string;

  @IsString()
  fieldName: string;

  @IsString()
  fieldType: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsNumber()
  sequence: number;

  @IsOptional()
  @IsString()
  passCriteria?: string;
}
