import { Module } from '@nestjs/common';
import { VendorAnalyticsController } from './vendor-analytics.controller';
import { VendorAnalyticsService } from './vendor-analytics.service';

@Module({
  controllers: [VendorAnalyticsController],
  providers: [VendorAnalyticsService],
})
export class VendorAnalyticsModule {}
