import {
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateDocumentDto {
  @IsString()
  documentName: string;

  @IsString()
  documentType: string;

  @IsString()
  moduleName: string;

  @IsString()
  referenceId: string;

  @IsString()
  filePath: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
