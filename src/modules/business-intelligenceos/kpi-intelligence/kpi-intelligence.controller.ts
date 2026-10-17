import { Controller, Get } from '@nestjs/common';
import { KpiIntelligenceService } from './kpi-intelligence.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
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
