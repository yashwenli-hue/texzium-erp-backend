import { Controller, Get } from '@nestjs/common';
import { VendorAnalyticsService } from './vendor-analytics.service';

@Controller('vendor-analytics')
export class VendorAnalyticsController {
  constructor(
    private readonly vendorAnalyticsService: VendorAnalyticsService,
  ) {}

  @Get('cost-summary')
  costSummary() {
    return this.vendorAnalyticsService.costSummary();
  }

  @Get('vendor-ranking')
  vendorRanking() {
    return this.vendorAnalyticsService.vendorRanking();
  }

  @Get('payment-exposure')
  paymentExposure() {
    return this.vendorAnalyticsService.paymentExposure();
  }
}
