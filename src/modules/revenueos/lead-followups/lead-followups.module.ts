import { Module } from '@nestjs/common';
import { LeadFollowupsController } from './lead-followups.controller';
import { LeadFollowupsService } from './lead-followups.service';

@Module({
  controllers: [LeadFollowupsController],
  providers: [LeadFollowupsService],
})
export class LeadFollowupsModule {}
