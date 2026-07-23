import { Body, Controller, Get, Post } from '@nestjs/common';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { CreateChartOfAccountDto } from './dto/create-chart-of-account.dto';

@Controller('chart-of-accounts')
export class ChartOfAccountsController {
  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
  ) {}

  @Post()
  create(@Body() body: CreateChartOfAccountDto) {
    return this.chartOfAccountsService.create(body);
  }

  @Get()
  findAll() {
    return this.chartOfAccountsService.findAll();
  }
}
