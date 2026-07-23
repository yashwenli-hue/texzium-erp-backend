import { Module } from '@nestjs/common';
import { ProjectCostsController } from './project-costs.controller';
import { ProjectCostsService } from './project-costs.service';

@Module({
  controllers: [ProjectCostsController],
  providers: [ProjectCostsService],
})
export class ProjectCostsModule {}
