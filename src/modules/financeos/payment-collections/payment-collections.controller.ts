import { Body, Controller, Get, Post } from '@nestjs/common';
import { PaymentCollectionsService } from './payment-collections.service';
import { CreatePaymentCollectionDto } from './dto/create-payment-collection.dto';

@Controller('payment-collections')
export class PaymentCollectionsController {
  constructor(
    private readonly paymentCollectionsService: PaymentCollectionsService,
  ) {}

  @Post()
  create(@Body() body: CreatePaymentCollectionDto) {
    return this.paymentCollectionsService.create(body);
  }

  @Get()
  findAll() {
    return this.paymentCollectionsService.findAll();
  }
}
