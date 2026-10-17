import { Controller, Get } from '@nestjs/common';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('executive-dashboard')
export class ExecutiveDashboardController {
  constructor(
    private readonly executiveDashboardService: ExecutiveDashboardService,
  ) {}

  @Get()
  getDashboard() {
    return this.executiveDashboardService.getDashboard();
  }
}
