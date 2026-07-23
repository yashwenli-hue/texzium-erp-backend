import { Module } from '@nestjs/common';
import { ProfitabilityDashboardController } from './profitability-dashboard.controller';
import { ProfitabilityDashboardService } from './profitability-dashboard.service';

@Module({
  controllers: [ProfitabilityDashboardController],
  providers: [ProfitabilityDashboardService],
})
export class ProfitabilityDashboardModule {}
