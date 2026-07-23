import { Body, Controller, Get, Post } from '@nestjs/common';
import { ProjectMasterService } from './project-master.service';
import { CreateProjectDto } from './dto/create-project.dto';

@Controller('projects')
export class ProjectMasterController {
  constructor(
    private readonly projectMasterService: ProjectMasterService,
  ) {}

  @Post('create')
  create(@Body() data: CreateProjectDto) {
    return this.projectMasterService.create(data);
  }

  @Get()
  findAll() {
    return this.projectMasterService.findAll();
  }
}
