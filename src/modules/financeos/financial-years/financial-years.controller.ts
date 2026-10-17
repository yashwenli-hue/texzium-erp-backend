import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { FinancialYearsService } from './financial-years.service';
import { CreateFinancialYearDto } from './dto/create-financial-year.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('financial-years')
export class FinancialYearsController {
  constructor(
    private readonly financialYearsService: FinancialYearsService,
  ) {}

  @Post()
  create(@Body() body: CreateFinancialYearDto) {
    return this.financialYearsService.create(body);
  }

  @Get()
  findAll() {
    return this.financialYearsService.findAll();
  }

  @Patch(':id/close')
  closeYear(@Param('id') id: string) {
    return this.financialYearsService.closeYear(id);
  }
}
