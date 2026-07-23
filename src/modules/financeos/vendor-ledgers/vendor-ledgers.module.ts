import { Module } from '@nestjs/common';
import { VendorLedgersController } from './vendor-ledgers.controller';
import { VendorLedgersService } from './vendor-ledgers.service';

@Module({
  controllers: [VendorLedgersController],
  providers: [VendorLedgersService],
})
export class VendorLedgersModule {}
