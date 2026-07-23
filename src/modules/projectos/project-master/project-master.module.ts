import { Module } from '@nestjs/common';
import { ProjectMasterController } from './project-master.controller';
import { ProjectMasterService } from './project-master.service';

@Module({
  controllers: [ProjectMasterController],
  providers: [ProjectMasterService],
})
export class ProjectMasterModule {}
