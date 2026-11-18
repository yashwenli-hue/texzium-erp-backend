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
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { financeScopeOf } from '../record-scope/record-scope';

@Controller('sales-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  @Post()
  @ScopedRecord('proforma', 'body.proformaInvoiceId')
  @Permissions('salesorders.create')
  create(@Body() body: CreateSalesOrderDto) {
    return this.salesOrdersService.create(body);
  }

  // Finance works from the sales order (advance receipts, commercial approval,
  // invoicing), so finance visibility sees every order; everyone else sees the
  // orders under their own leads, as for the rest of the pipeline.
  @Get()
  @Permissions('salesorders.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.salesOrdersService.findAll(financeScopeOf(req.user));
  }

  // Cancels an order for good. The actor is the signed-in user.
  @Post(':id/cancel')
  @ScopedRecord('salesOrder', 'params.id')
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
  @ScopedRecord('salesOrder', 'params.id', { finance: true })
  @Permissions('salesorders.view')
  findEvents(@Param('id') id: string) {
    return this.salesOrdersService.findEvents(id);
  }
}
