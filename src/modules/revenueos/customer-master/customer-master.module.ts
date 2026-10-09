import { Module } from '@nestjs/common';
import { CustomerDeletionController } from './customer-deletion.controller';
import { CustomerMasterController } from './customer-master.controller';
import { CustomerMasterService } from './customer-master.service';
import { CustomerOverviewService } from './customer-overview.service';

@Module({
  controllers: [CustomerMasterController, CustomerDeletionController],
  providers: [CustomerMasterService, CustomerOverviewService],
})
export class CustomerMasterModule {}
