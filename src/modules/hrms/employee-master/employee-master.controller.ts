import { Body, Controller, Get, Post } from '@nestjs/common';
import { EmployeeMasterService } from './employee-master.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

@Controller('employees')
export class EmployeeMasterController {
  constructor(
    private readonly employeeMasterService: EmployeeMasterService,
  ) {}

  @Post('create')
  create(@Body() data: CreateEmployeeDto) {
    return this.employeeMasterService.create(data);
  }

  @Get()
  findAll() {
    return this.employeeMasterService.findAll();
  }
}
