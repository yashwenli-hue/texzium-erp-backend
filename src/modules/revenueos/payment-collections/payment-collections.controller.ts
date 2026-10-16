import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { PaymentCollectionsService } from './payment-collections.service';
import { CreatePaymentCollectionDto } from './dto/create-payment-collection.dto';
import { ListPaymentCollectionsQueryDto } from './dto/list-payment-collections-query.dto';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { scopeOf } from '../record-scope/record-scope';

// Reading needs collections.view, recording needs collections.record. The
// recorder is the signed-in user; it is never accepted from the request.
@Controller('payment-collections')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class PaymentCollectionsController {
  constructor(
    private readonly paymentCollectionsService: PaymentCollectionsService,
  ) {}

  @Post()
  @ScopedRecord('salesInvoice', 'body.salesInvoiceId')
  @Permissions('collections.record')
  create(
    @Body() data: CreatePaymentCollectionDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.paymentCollectionsService.create(data, req.user?.id);
  }

  @Get()
  @Permissions('collections.view')
  findAll(
    @Query() query: ListPaymentCollectionsQueryDto,
    @Req() req: { user?: { id?: string; permissions?: unknown } },
  ) {
    return this.paymentCollectionsService.findAll(query, scopeOf(req.user));
  }

  // One invoice's receivable with its collections and events.
  @Get('invoices/:salesInvoiceId')
  @ScopedRecord('salesInvoice', 'params.salesInvoiceId')
  @Permissions('collections.view')
  findByInvoice(
    @Param('salesInvoiceId', new ParseUUIDPipe()) salesInvoiceId: string,
  ) {
    return this.paymentCollectionsService.findByInvoice(salesInvoiceId);
  }

  @Get(':id')
  @ScopedRecord('paymentCollection', 'params.id')
  @Permissions('collections.view')
  findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.paymentCollectionsService.findOne(id);
  }
}
