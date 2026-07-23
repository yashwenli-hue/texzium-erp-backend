import {
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateWorkflowDto {
  @IsString()
  module: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
