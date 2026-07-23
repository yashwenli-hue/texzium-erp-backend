import { Controller, Get } from '@nestjs/common';
import { HrmsDashboardService } from './hrms-dashboard.service';

@Controller('hrms-dashboard')
export class HrmsDashboardController {
  constructor(
    private readonly hrmsDashboardService: HrmsDashboardService,
  ) {}

  @Get('attendance-summary')
  attendanceSummary() {
    return this.hrmsDashboardService.attendanceSummary();
  }

  @Get('leave-summary')
  leaveSummary() {
    return this.hrmsDashboardService.leaveSummary();
  }

  @Get('employee-cost-summary')
  employeeCostSummary() {
    return this.hrmsDashboardService.employeeCostSummary();
  }

  @Get('payroll-summary')
  payrollSummary() {
    return this.hrmsDashboardService.payrollSummary();
  }
}
