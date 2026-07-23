import { Controller, Get } from '@nestjs/common';
import { CollectionsDashboardService } from './collections-dashboard.service';

@Controller('collections-dashboard')
export class CollectionsDashboardController {
  constructor(
    private readonly collectionsDashboardService: CollectionsDashboardService,
  ) {}

  @Get('summary')
  summary() {
    return this.collectionsDashboardService.summary();
  }

  @Get('aging')
  aging() {
    return this.collectionsDashboardService.aging();
  }

  @Get('high-risk')
  highRisk() {
    return this.collectionsDashboardService.highRisk();
  }

  @Get('recovery-rate')
  recoveryRate() {
    return this.collectionsDashboardService.recoveryRate();
 }

  @Get('customer-ranking')
  customerRanking() {
    return this.collectionsDashboardService.customerRanking();
 }

  @Get('efficiency')
  efficiency() {
    return this.collectionsDashboardService.efficiency();
 }

}
