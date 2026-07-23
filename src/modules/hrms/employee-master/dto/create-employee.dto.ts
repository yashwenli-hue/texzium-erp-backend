import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  employeeCode: string;

  @IsString()
  fullName: string;

  @IsString()
  department: string;

  @IsString()
  designation: string;

  @IsDateString()
  joiningDate: string;

  @IsNumber()
  salary: number;

  @IsOptional()
  @IsString()
  reportingTo?: string;
}
