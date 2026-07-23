import { IsOptional, IsString } from 'class-validator';

export class CreateTreatmentJobDto {
  @IsString()
  stockInspectionId: string;

  @IsString()
  jobType: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
