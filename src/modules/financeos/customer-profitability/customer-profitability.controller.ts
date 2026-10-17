import { Controller, Get } from '@nestjs/common';
import { CustomerProfitabilityService } from './customer-profitability.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('customer-profitability')
export class CustomerProfitabilityController {
  constructor(
    private readonly customerProfitabilityService: CustomerProfitabilityService,
  ) {}

  @Get('summary')
  summary() {
    return this.customerProfitabilityService.summary();
  }
}
