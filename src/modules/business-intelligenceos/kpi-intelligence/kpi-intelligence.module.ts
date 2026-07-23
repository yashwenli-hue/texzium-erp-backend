import { Module } from '@nestjs/common';
import { KpiIntelligenceController } from './kpi-intelligence.controller';
import { KpiIntelligenceService } from './kpi-intelligence.service';

@Module({
  controllers: [KpiIntelligenceController],
  providers: [KpiIntelligenceService],
})
export class KpiIntelligenceModule {}
