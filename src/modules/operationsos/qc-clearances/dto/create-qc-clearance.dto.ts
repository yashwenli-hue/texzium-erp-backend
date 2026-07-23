import { IsOptional, IsString } from 'class-validator';

export class CreateQcClearanceDto {
  @IsString()
  treatmentJobId: string;

  @IsString()
  qcDate: string;

  @IsString()
  qcStatus: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}
