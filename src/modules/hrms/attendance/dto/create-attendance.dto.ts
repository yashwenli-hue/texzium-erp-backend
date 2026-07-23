import {
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateAttendanceDto {
  @IsString()
  employeeId: string;

  @IsDateString()
  attendanceDate: string;

  @IsString()
  status: string;

  @IsOptional()
  @IsDateString()
  checkInTime?: string;

  @IsOptional()
  @IsDateString()
  checkOutTime?: string;
}
