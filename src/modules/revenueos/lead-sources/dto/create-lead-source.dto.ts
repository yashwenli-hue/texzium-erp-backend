import { IsOptional, IsString } from 'class-validator';

export class CreateLeadSourceDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
