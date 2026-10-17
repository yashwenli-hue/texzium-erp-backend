import { Controller, Get } from '@nestjs/common';
import { ProfitabilityDashboardService } from './profitability-dashboard.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
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
