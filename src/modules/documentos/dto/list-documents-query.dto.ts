import { IsOptional, IsString } from 'class-validator';

// GET /documents filters (they replace the former /documents/module/:moduleName and
// /documents/reference/:referenceId routes). Unknown query parameters are refused.
export class ListDocumentsQueryDto {
  @IsOptional()
  @IsString()
  moduleName?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;
}
