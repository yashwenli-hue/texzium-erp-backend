import { Module } from '@nestjs/common';
import { LeadQuotationsController } from './lead-quotations.controller';
import { LeadQuotationsService } from './lead-quotations.service';

@Module({
  controllers: [LeadQuotationsController],
  providers: [LeadQuotationsService],
})
export class LeadQuotationsModule {}
