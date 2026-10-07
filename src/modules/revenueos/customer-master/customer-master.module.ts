import { Module } from '@nestjs/common';
import { CustomerMasterController } from './customer-master.controller';
import { CustomerMasterService } from './customer-master.service';
import { CustomerOverviewService } from './customer-overview.service';

@Module({
  controllers: [CustomerMasterController],
  providers: [CustomerMasterService, CustomerOverviewService],
})
export class CustomerMasterModule {}
