import { Global, Module } from '@nestjs/common';

import { DataDeletionsController } from './data-deletion.controller';
import { DataDeletionPurgeWorker } from './data-deletion-purge.worker';
import { DataDeletionService } from './data-deletion.service';

// The shared deletion service, available to every module that has something that may
// be deleted (a policy per kind of record lives with that record), and the worker that
// purges what nobody restored once its recovery window has ended.
@Global()
@Module({
  controllers: [DataDeletionsController],
  providers: [DataDeletionService, DataDeletionPurgeWorker],
  exports: [DataDeletionService],
})
export class DataGovernanceModule {}
