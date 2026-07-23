import { Module } from '@nestjs/common';
import { AiBusinessAdvisorController } from './ai-business-advisor.controller';
import { AiBusinessAdvisorService } from './ai-business-advisor.service';

@Module({
  controllers: [AiBusinessAdvisorController],
  providers: [AiBusinessAdvisorService],
})
export class AiBusinessAdvisorModule {}
