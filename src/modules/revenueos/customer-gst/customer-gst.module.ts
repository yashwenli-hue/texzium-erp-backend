import { Module } from '@nestjs/common';
import { CustomerGstController } from './customer-gst.controller';
import { CustomerGstService } from './customer-gst.service';

@Module({
  controllers: [CustomerGstController],
  providers: [CustomerGstService],
})
export class CustomerGstModule {}
