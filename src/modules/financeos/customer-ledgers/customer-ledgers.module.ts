import { Module } from '@nestjs/common';
import { CustomerLedgersController } from './customer-ledgers.controller';
import { CustomerLedgersService } from './customer-ledgers.service';

@Module({
  controllers: [CustomerLedgersController],
  providers: [CustomerLedgersService],
})
export class CustomerLedgersModule {}
