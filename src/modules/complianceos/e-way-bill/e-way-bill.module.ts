import { Module } from '@nestjs/common';
import { EWayBillController } from './e-way-bill.controller';
import { EWayBillService } from './e-way-bill.service';

@Module({
  controllers: [EWayBillController],
  providers: [EWayBillService],
})
export class EWayBillModule {}
