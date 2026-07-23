import { Controller, Get } from '@nestjs/common';
import { CustomerProfitabilityService } from './customer-profitability.service';

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
