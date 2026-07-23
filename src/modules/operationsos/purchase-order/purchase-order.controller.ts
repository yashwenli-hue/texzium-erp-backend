import { Body, Controller, Get, Post } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';

@Controller('purchase-order')
export class PurchaseOrderController {
  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
  ) {}

  @Post('create')
  create(@Body() data: CreatePurchaseOrderDto) {
    return this.purchaseOrderService.create(data);
  }

  @Get()
  findAll() {
    return this.purchaseOrderService.findAll();
  }
}
