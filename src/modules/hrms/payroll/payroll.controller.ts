import { Body, Controller, Get, Post } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';

@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('generate')
  generate(@Body() data: CreatePayrollDto) {
    return this.payrollService.generate(data);
  }

  @Get()
  findAll() {
    return this.payrollService.findAll();
  }
}
