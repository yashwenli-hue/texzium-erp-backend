import { Module } from '@nestjs/common';
import { LeadBantController } from './lead-bant.controller';
import { LeadBantService } from './lead-bant.service';

@Module({
  controllers: [LeadBantController],
  providers: [LeadBantService],
})
export class LeadBantModule {}
