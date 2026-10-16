import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SalesOrderAdvanceReceiptService } from './sales-order-advance-receipt.service';
import { CreateSalesOrderAdvanceReceiptDto } from './dto/create-sales-order-advance-receipt.dto';
import { VerifySalesOrderAdvanceReceiptDto } from './dto/verify-sales-order-advance-receipt.dto';
import { RetractSalesOrderAdvanceReceiptVerificationDto } from './dto/retract-sales-order-advance-receipt-verification.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { scopeOf } from '../record-scope/record-scope';

@Controller('sales-order-advance-receipt')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class SalesOrderAdvanceReceiptController {
  constructor(
    private readonly salesOrderAdvanceReceiptService: SalesOrderAdvanceReceiptService,
  ) {}

  @Post('create')
  @ScopedRecord('salesOrder', 'body.salesOrderId')
  @Permissions('salesorders.advancereceipts.create')
  create(@Body() data: CreateSalesOrderAdvanceReceiptDto) {
    return this.salesOrderAdvanceReceiptService.create(data);
  }

  // Verifies or rejects a pending receipt. The actor is the signed-in user.
  @Patch(':id/verify')
  @ScopedRecord('advanceReceipt', 'params.id')
  @Permissions('salesorders.advancereceipts.verify')
  verify(
    @Param('id') id: string,
    @Body() data: VerifySalesOrderAdvanceReceiptDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.salesOrderAdvanceReceiptService.verify(id, req.user?.id, data);
  }

  // Undoes a verification. The actor is the signed-in user.
  @Patch(':id/retract-verification')
  @ScopedRecord('advanceReceipt', 'params.id')
  @Permissions('salesorders.advancereceipts.retract')
  retractVerification(
    @Param('id') id: string,
    @Body() data: RetractSalesOrderAdvanceReceiptVerificationDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.salesOrderAdvanceReceiptService.retractVerification(
      id,
      req.user?.id,
      data,
    );
  }

  @Get()
  @Permissions('salesorders.advancereceipts.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.salesOrderAdvanceReceiptService.findAll(scopeOf(req.user));
  }
}
