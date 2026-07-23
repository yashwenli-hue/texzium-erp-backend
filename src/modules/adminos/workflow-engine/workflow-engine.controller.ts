import { Body, Controller, Get, Post } from '@nestjs/common';
import { WorkflowEngineService } from './workflow-engine.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';

@Controller('workflow-engine')
export class WorkflowEngineController {
  constructor(
    private readonly workflowEngineService: WorkflowEngineService,
  ) {}

  @Post('create')
  create(@Body() data: CreateWorkflowDto) {
    return this.workflowEngineService.create(data);
  }

  @Get()
  findAll() {
    return this.workflowEngineService.findAll();
  }
}
