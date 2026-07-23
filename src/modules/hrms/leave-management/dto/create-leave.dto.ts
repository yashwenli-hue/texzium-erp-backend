import {
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateLeaveDto {
  @IsString()
  employeeId: string;

  @IsString()
  leaveType: string;

  @IsDateString()
  fromDate: string;

  @IsDateString()
  toDate: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
