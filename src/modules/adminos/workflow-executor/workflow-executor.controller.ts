import { Body, Controller, Post } from '@nestjs/common';
import { WorkflowExecutorService } from './workflow-executor.service';

@Controller('workflow-executor')
export class WorkflowExecutorController {
  constructor(
    private readonly workflowExecutorService: WorkflowExecutorService,
  ) {}

  @Post('execute')
  execute(@Body() body: any) {
    return this.workflowExecutorService.execute(body);
  }
}
