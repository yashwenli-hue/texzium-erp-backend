import { Module } from '@nestjs/common';
import { VendorBillController } from './vendor-bill.controller';
import { VendorBillService } from './vendor-bill.service';

@Module({
  controllers: [VendorBillController],
  providers: [VendorBillService],
})
export class VendorBillModule {}
