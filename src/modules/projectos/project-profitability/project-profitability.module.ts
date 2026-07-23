import { Module } from '@nestjs/common';
import { ProjectProfitabilityController } from './project-profitability.controller';
import { ProjectProfitabilityService } from './project-profitability.service';

@Module({
  controllers: [ProjectProfitabilityController],
  providers: [ProjectProfitabilityService],
})
export class ProjectProfitabilityModule {}
