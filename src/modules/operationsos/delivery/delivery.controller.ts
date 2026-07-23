import { Body, Controller, Get, Post } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Post()
  create(@Body() body: CreateDeliveryDto) {
    return this.deliveryService.create(body);
  }

  @Get()
  findAll() {
    return this.deliveryService.findAll();
  }
}
