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

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('sales-order-advance-receipt')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesOrderAdvanceReceiptController {
  constructor(
    private readonly salesOrderAdvanceReceiptService: SalesOrderAdvanceReceiptService,
  ) {}

  @Post('create')
  @Permissions('salesorders.advancereceipts.create')
  create(@Body() data: CreateSalesOrderAdvanceReceiptDto) {
    return this.salesOrderAdvanceReceiptService.create(data);
  }

  // Verifies or rejects a pending receipt. The actor is the signed-in user.
  @Patch(':id/verify')
  @Permissions('salesorders.advancereceipts.verify')
  verify(
    @Param('id') id: string,
    @Body() data: VerifySalesOrderAdvanceReceiptDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.salesOrderAdvanceReceiptService.verify(id, req.user?.id, data);
  }

  @Get()
  @Permissions('salesorders.advancereceipts.view')
  findAll() {
    return this.salesOrderAdvanceReceiptService.findAll();
  }
}
