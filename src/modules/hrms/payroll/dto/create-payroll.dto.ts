import { IsString } from 'class-validator';

export class CreatePayrollDto {
  @IsString()
  employeeId: string;

  @IsString()
  payrollMonth: string;
}
