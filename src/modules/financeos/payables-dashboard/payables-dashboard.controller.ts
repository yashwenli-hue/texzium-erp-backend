import { Controller, Get } from '@nestjs/common';
import { PayablesDashboardService } from './payables-dashboard.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('payables-dashboard')
export class PayablesDashboardController {
  constructor(
    private readonly payablesDashboardService: PayablesDashboardService,
  ) {}

  @Get('summary')
  summary() {
    return this.payablesDashboardService.summary();
  }

  @Get('aging')
  aging() {
    return this.payablesDashboardService.aging();
  }

  @Get('high-risk')
  highRisk() {
    return this.payablesDashboardService.highRisk();
  }

  @Get('upcoming-due')
  upcomingDue() {
    return this.payablesDashboardService.upcomingDue();
  }
}
