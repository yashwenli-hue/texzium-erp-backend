import { Module } from '@nestjs/common';
import { WorkflowExecutorController } from './workflow-executor.controller';
import { WorkflowExecutorService } from './workflow-executor.service';

@Module({
  controllers: [WorkflowExecutorController],
  providers: [WorkflowExecutorService],
})
export class WorkflowExecutorModule {}
