import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ProjectTasksService } from './project-tasks.service';
import { CreateProjectTaskDto } from './dto/create-project-task.dto';

@Controller('project-tasks')
export class ProjectTasksController {
  constructor(
    private readonly projectTasksService: ProjectTasksService,
  ) {}

  @Post('create')
  create(@Body() data: CreateProjectTaskDto) {
    return this.projectTasksService.create(data);
  }

  @Get()
  findAll() {
    return this.projectTasksService.findAll();
  }

  @Get('project/:id')
  findByProject(@Param('id') id: string) {
    return this.projectTasksService.findByProject(id);
  }

  @Patch('progress/:id/:value')
  updateProgress(
    @Param('id') id: string,
    @Param('value') value: string,
  ) {
    return this.projectTasksService.updateProgress(
      id,
      Number(value),
    );
  }
}
