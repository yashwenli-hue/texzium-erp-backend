import { Module } from '@nestjs/common';
import { PaymentGatewayConfigController } from './payment-gateway-config.controller';
import { PaymentGatewayConfigService } from './payment-gateway-config.service';

@Module({
  controllers: [PaymentGatewayConfigController],
  providers: [PaymentGatewayConfigService],
})
export class PaymentGatewayConfigModule {}
