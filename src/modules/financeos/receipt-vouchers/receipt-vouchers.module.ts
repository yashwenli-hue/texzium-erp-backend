import { Module } from '@nestjs/common';
import { ReceiptVouchersController } from './receipt-vouchers.controller';
import { ReceiptVouchersService } from './receipt-vouchers.service';

@Module({
  controllers: [ReceiptVouchersController],
  providers: [ReceiptVouchersService],
})
export class ReceiptVouchersModule {}
