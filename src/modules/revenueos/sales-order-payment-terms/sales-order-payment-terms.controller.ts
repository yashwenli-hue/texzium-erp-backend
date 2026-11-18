import { Body, Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { SalesOrderPaymentTermsService } from './sales-order-payment-terms.service';
import { CreateSalesOrderPaymentTermDto } from './dto/create-sales-order-payment-term.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { financeScopeOf } from '../record-scope/record-scope';

@Controller('sales-order-payment-terms')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class SalesOrderPaymentTermsController {
  constructor(
    private readonly salesOrderPaymentTermsService: SalesOrderPaymentTermsService,
  ) {}

  @Post('create')
  @ScopedRecord('salesOrder', 'body.salesOrderId')
  @Permissions('salesorders.paymentterms.create')
  create(@Body() data: CreateSalesOrderPaymentTermDto) {
    return this.salesOrderPaymentTermsService.create(data);
  }

  @Get()
  @Permissions('salesorders.paymentterms.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.salesOrderPaymentTermsService.findAll(financeScopeOf(req.user));
  }
}
