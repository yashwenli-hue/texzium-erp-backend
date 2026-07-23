import { Body, Controller, Get, Post } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(
    private readonly salesOrdersService: SalesOrdersService,
  ) {}

  @Post()
  create(@Body() body: CreateSalesOrderDto) {
    return this.salesOrdersService.create(body);
  }

  @Get()
  findAll() {
    return this.salesOrdersService.findAll();
  }
}
