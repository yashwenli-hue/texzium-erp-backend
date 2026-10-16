import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { SalesInvoiceItemsService } from './sales-invoice-items.service';
import { CreateSalesInvoiceItemDto } from './dto/create-sales-invoice-item.dto';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';

// Adding an item to an invoice needs invoices.create (it was open to any
// signed-in user before).
@Controller('sales-invoice-items')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class SalesInvoiceItemsController {
  constructor(
    private readonly salesInvoiceItemsService: SalesInvoiceItemsService,
  ) {}

  @Post()
  @ScopedRecord('salesInvoice', 'body.salesInvoiceId')
  @Permissions('invoices.create')
  create(@Body() data: CreateSalesInvoiceItemDto) {
    return this.salesInvoiceItemsService.create(data);
  }
}
