import { Body, Controller, Get, Post } from '@nestjs/common';
import { ProjectBillingService } from './project-billing.service';
import { CreateProjectBillingDto } from './dto/create-project-billing.dto';

@Controller('project-billing')
export class ProjectBillingController {
  constructor(
    private readonly projectBillingService: ProjectBillingService,
  ) {}

  @Post('create')
  create(@Body() data: CreateProjectBillingDto) {
    return this.projectBillingService.create(data);
  }

  @Get()
  findAll() {
    return this.projectBillingService.findAll();
  }
}
