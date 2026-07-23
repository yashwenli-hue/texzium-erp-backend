import { Module } from '@nestjs/common';
import { GstReconciliationController } from './gst-reconciliation.controller';
import { GstReconciliationService } from './gst-reconciliation.service';

@Module({
  controllers: [GstReconciliationController],
  providers: [GstReconciliationService],
})
export class GstReconciliationModule {}
