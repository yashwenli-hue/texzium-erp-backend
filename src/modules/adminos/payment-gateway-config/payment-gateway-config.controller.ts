import { Body, Controller, Get, Post } from '@nestjs/common';
import { PaymentGatewayConfigService } from './payment-gateway-config.service';
import { CreatePaymentGatewayDto } from './dto/create-payment-gateway.dto';

@Controller('payment-gateway-config')
export class PaymentGatewayConfigController {
  constructor(
    private readonly paymentGatewayConfigService: PaymentGatewayConfigService,
  ) {}

  @Post()
  create(@Body() data: CreatePaymentGatewayDto) {
    return this.paymentGatewayConfigService.create(data);
  }

  @Get()
  findAll() {
    return this.paymentGatewayConfigService.findAll();
  }

  @Get('active')
  getActiveGateway() {
    return this.paymentGatewayConfigService.getActiveGateway();
  }
}
