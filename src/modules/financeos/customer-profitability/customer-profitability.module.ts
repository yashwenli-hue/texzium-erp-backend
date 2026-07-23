import { Module } from '@nestjs/common';
import { CustomerProfitabilityController } from './customer-profitability.controller';
import { CustomerProfitabilityService } from './customer-profitability.service';

@Module({
  controllers: [CustomerProfitabilityController],
  providers: [CustomerProfitabilityService],
})
export class CustomerProfitabilityModule {}
