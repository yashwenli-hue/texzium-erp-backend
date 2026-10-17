import { Controller, Get } from '@nestjs/common';
import { AiBusinessAdvisorService } from './ai-business-advisor.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
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
