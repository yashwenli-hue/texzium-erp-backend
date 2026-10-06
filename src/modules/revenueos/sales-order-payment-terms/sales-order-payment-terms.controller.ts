import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SalesOrderPaymentTermsService } from './sales-order-payment-terms.service';
import { CreateSalesOrderPaymentTermDto } from './dto/create-sales-order-payment-term.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('sales-order-payment-terms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesOrderPaymentTermsController {
  constructor(
    private readonly salesOrderPaymentTermsService: SalesOrderPaymentTermsService,
  ) {}

  @Post('create')
  @Permissions('salesorders.paymentterms.create')
  create(@Body() data: CreateSalesOrderPaymentTermDto) {
    return this.salesOrderPaymentTermsService.create(data);
  }

  @Get()
  @Permissions('salesorders.paymentterms.view')
  findAll() {
    return this.salesOrderPaymentTermsService.findAll();
  }
}
