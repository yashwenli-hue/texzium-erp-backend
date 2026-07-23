import { Controller, Get } from '@nestjs/common';
import { KpiIntelligenceService } from './kpi-intelligence.service';

@Controller('kpi-intelligence')
export class KpiIntelligenceController {
  constructor(
    private readonly kpiIntelligenceService: KpiIntelligenceService,
  ) {}

  @Get()
  getKPIs() {
    return this.kpiIntelligenceService.getKPIs();
  }
}
