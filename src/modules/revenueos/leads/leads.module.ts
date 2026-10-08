import { Module } from '@nestjs/common';

import { LeadDeletionController } from './lead-deletion.controller';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  controllers: [
    LeadsController,
    LeadDeletionController,
  ],
  providers: [
    LeadsService,
  ],
})
export class LeadsModule {}
