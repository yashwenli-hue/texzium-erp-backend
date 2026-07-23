import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateProjectBillingDto {
  @IsString()
  projectId: string;

  @IsDateString()
  billingDate: string;

  @IsNumber()
  billingAmount: number;

  @IsString()
  billingType: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
