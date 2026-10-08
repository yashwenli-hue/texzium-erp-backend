import { Global, Module } from '@nestjs/common';

import { DataDeletionsController } from './data-deletion.controller';
import { DataDeletionService } from './data-deletion.service';

// The shared deletion service, available to every module that has something that may
// be deleted (a policy per kind of record lives with that record).
@Global()
@Module({
  controllers: [DataDeletionsController],
  providers: [DataDeletionService],
  exports: [DataDeletionService],
})
export class DataGovernanceModule {}
