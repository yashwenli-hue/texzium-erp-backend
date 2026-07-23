import { Module } from '@nestjs/common';
import { HsnMasterController } from './hsn-master.controller';
import { HsnMasterService } from './hsn-master.service';

@Module({
  controllers: [HsnMasterController],
  providers: [HsnMasterService],
})
export class HsnMasterModule {}
