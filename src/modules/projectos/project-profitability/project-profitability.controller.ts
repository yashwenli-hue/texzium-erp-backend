import { Controller, Get, Param } from '@nestjs/common';
import { ProjectProfitabilityService } from './project-profitability.service';

@Controller('project-profitability')
export class ProjectProfitabilityController {
  constructor(
    private readonly projectProfitabilityService: ProjectProfitabilityService,
  ) {}

  @Get(':projectId')
  summary(@Param('projectId') projectId: string) {
    return this.projectProfitabilityService.summary(projectId);
  }
}
