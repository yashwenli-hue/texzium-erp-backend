import { Controller, Get } from '@nestjs/common';
import { CashflowDashboardService } from './cashflow-dashboard.service';

@Controller('cashflow-dashboard')
export class CashflowDashboardController {
  constructor(
    private readonly cashflowDashboardService: CashflowDashboardService,
  ) {}

  @Get('summary')
  summary() {
    return this.cashflowDashboardService.summary();
  }
}
