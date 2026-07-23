import { IsString } from 'class-validator';

export class CreateCommissioningTemplateDto {
  @IsString()
  name: string;
}
