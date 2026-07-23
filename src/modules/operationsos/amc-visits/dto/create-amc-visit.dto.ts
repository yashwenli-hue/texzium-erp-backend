import { IsOptional, IsString } from 'class-validator';

export class CreateAmcVisitDto {
  @IsString()
  amcId: string;

  @IsString()
  scheduledDate: string;

  @IsOptional()
  @IsString()
  engineerName?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
