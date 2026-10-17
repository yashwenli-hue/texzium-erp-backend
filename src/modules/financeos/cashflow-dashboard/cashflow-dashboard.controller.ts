import { Controller, Get } from '@nestjs/common';
import { CashflowDashboardService } from './cashflow-dashboard.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
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
