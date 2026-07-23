import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ProjectCostsService } from './project-costs.service';
import { CreateProjectCostDto } from './dto/create-project-cost.dto';

@Controller('project-costs')
export class ProjectCostsController {
  constructor(
    private readonly projectCostsService: ProjectCostsService,
  ) {}

  @Post('create')
  create(@Body() data: CreateProjectCostDto) {
    return this.projectCostsService.create(data);
  }

  @Get()
  findAll() {
    return this.projectCostsService.findAll();
  }

  @Get('project/:id')
  findByProject(@Param('id') id: string) {
    return this.projectCostsService.findByProject(id);
  }

  @Get('project/:id/summary')
  summary(@Param('id') id: string) {
    return this.projectCostsService.summary(id);
  }
}
