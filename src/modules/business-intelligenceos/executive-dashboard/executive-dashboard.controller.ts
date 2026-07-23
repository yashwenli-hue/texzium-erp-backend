import { Controller, Get } from '@nestjs/common';
import { ExecutiveDashboardService } from './executive-dashboard.service';

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
