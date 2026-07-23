import { Module } from '@nestjs/common';
import { LeadAssignmentsController } from './lead-assignments.controller';
import { LeadAssignmentsService } from './lead-assignments.service';

@Module({
  controllers: [LeadAssignmentsController],
  providers: [LeadAssignmentsService],
})
export class LeadAssignmentsModule {}
