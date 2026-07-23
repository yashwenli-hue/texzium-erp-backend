import { Module } from '@nestjs/common';
import { CompanyMasterController } from './company-master.controller';
import { CompanyMasterService } from './company-master.service';

@Module({
  controllers: [CompanyMasterController],
  providers: [CompanyMasterService],
})
export class CompanyMasterModule {}
