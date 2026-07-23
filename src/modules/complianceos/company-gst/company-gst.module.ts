import { Module } from '@nestjs/common';
import { CompanyGstController } from './company-gst.controller';
import { CompanyGstService } from './company-gst.service';

@Module({
  controllers: [CompanyGstController],
  providers: [CompanyGstService],
})
export class CompanyGstModule {}
