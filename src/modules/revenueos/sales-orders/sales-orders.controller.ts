import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SalesOrdersService } from './sales-orders.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { CancelSalesOrderDto } from './dto/cancel-sales-order.dto';

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

  // Cancels an order for good. The actor is the signed-in user.
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('salesorders.cancel')
  cancel(
    @Param('id') id: string,
    @Body() data: CancelSalesOrderDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.salesOrdersService.cancel(id, req.user?.id, data);
  }

  @Get(':id/events')
  @Permissions('salesorders.view')
  findEvents(@Param('id') id: string) {
    return this.salesOrdersService.findEvents(id);
  }
}
