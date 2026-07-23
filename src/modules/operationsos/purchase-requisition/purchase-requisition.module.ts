import { Module } from '@nestjs/common';
import { PurchaseRequisitionController } from './purchase-requisition.controller';
import { PurchaseRequisitionService } from './purchase-requisition.service';

@Module({
  controllers: [PurchaseRequisitionController],
  providers: [PurchaseRequisitionService],
})
export class PurchaseRequisitionModule {}
