import { Module } from '@nestjs/common';
import { CashflowDashboardController } from './cashflow-dashboard.controller';
import { CashflowDashboardService } from './cashflow-dashboard.service';

@Module({
  controllers: [CashflowDashboardController],
  providers: [CashflowDashboardService],
})
export class CashflowDashboardModule {}
