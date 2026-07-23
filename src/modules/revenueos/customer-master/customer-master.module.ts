import { Module } from '@nestjs/common';
import { CustomerMasterController } from './customer-master.controller';
import { CustomerMasterService } from './customer-master.service';

@Module({
  controllers: [CustomerMasterController],
  providers: [CustomerMasterService],
})
export class CustomerMasterModule {}
