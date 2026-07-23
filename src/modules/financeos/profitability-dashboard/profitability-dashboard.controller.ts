import { Controller, Get } from '@nestjs/common';
import { ProfitabilityDashboardService } from './profitability-dashboard.service';

@Controller('profitability-dashboard')
export class ProfitabilityDashboardController {
  constructor(
    private readonly profitabilityDashboardService: ProfitabilityDashboardService,
  ) {}

  @Get('summary')
  summary() {
    return this.profitabilityDashboardService.summary();
  }
}
