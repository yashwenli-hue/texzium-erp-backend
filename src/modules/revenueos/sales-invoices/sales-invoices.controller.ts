import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { SalesInvoicesService } from './sales-invoices.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';

// Issuing an invoice needs invoices.create; reading invoices needs
// invoices.view (both were open to any signed-in user before).
@Controller('sales-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesInvoicesController {
  constructor(private readonly salesInvoicesService: SalesInvoicesService) {}

  @Post()
  @Permissions('invoices.create')
  create(@Body() body: CreateSalesInvoiceDto) {
    return this.salesInvoicesService.create(body);
  }

  @Get()
  @Permissions('invoices.view')
  findAll() {
    return this.salesInvoicesService.findAll();
  }
}
