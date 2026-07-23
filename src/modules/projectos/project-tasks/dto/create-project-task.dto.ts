import {
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateProjectTaskDto {
  @IsString()
  projectId: string;

  @IsString()
  taskName: string;

  @IsOptional()
  @IsString()
  assignedToId?: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
