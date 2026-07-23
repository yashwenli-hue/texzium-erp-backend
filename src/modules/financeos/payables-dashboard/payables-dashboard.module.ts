import { Module } from '@nestjs/common';
import { PayablesDashboardController } from './payables-dashboard.controller';
import { PayablesDashboardService } from './payables-dashboard.service';

@Module({
  controllers: [PayablesDashboardController],
  providers: [PayablesDashboardService],
})
export class PayablesDashboardModule {}
