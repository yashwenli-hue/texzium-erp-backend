import { Module } from '@nestjs/common';
import { TreatmentJobsController } from './treatment-jobs.controller';
import { TreatmentJobsService } from './treatment-jobs.service';

@Module({
  controllers: [TreatmentJobsController],
  providers: [TreatmentJobsService],
})
export class TreatmentJobsModule {}
