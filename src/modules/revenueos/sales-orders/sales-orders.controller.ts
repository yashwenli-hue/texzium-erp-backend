import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('sales-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Post()
  @Permissions('salesorders.create')
  create(@Body() body: CreateSalesOrderDto) {
    return this.salesOrdersService.create(body);
  }

  @Get()
  @Permissions('salesorders.view')
  findAll() {
    return this.salesOrdersService.findAll();
  }

  @Get(':id/events')
  @Permissions('salesorders.view')
  findEvents(@Param('id') id: string) {
    return this.salesOrdersService.findEvents(id);
  }
}
