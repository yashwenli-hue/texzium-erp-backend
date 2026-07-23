import {
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateProjectCostDto {
  @IsString()
  projectId: string;

  @IsString()
  costType: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  amount: number;
}
