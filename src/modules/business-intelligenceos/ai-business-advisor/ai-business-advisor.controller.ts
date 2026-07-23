import { Controller, Get } from '@nestjs/common';
import { AiBusinessAdvisorService } from './ai-business-advisor.service';

@Controller('ai-business-advisor')
export class AiBusinessAdvisorController {
  constructor(
    private readonly aiBusinessAdvisorService: AiBusinessAdvisorService,
  ) {}

  @Get()
  advise() {
    return this.aiBusinessAdvisorService.advise();
  }
}
