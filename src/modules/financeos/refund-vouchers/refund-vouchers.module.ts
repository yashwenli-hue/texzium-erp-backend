import { Module } from '@nestjs/common';
import { RefundVouchersController } from './refund-vouchers.controller';
import { RefundVouchersService } from './refund-vouchers.service';

@Module({
  controllers: [RefundVouchersController],
  providers: [RefundVouchersService],
})
export class RefundVouchersModule {}
