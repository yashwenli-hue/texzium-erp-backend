import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { ReceiptVouchersService } from './receipt-vouchers.service';
import { ListReceiptVouchersQueryDto } from './dto/list-receipt-vouchers-query.dto';

// Generating a receipt needs collections.record (the permission that records
// the payment); reading receipts needs collections.view.
@Controller('receipt-vouchers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReceiptVouchersController {
  constructor(
    private readonly receiptVouchersService: ReceiptVouchersService,
  ) {}

  @Post(':paymentCollectionId/generate')
  @Permissions('collections.record')
  generate(
    @Param('paymentCollectionId', new ParseUUIDPipe())
    paymentCollectionId: string,
  ) {
    return this.receiptVouchersService.generate(paymentCollectionId);
  }

  @Get()
  @Permissions('collections.view')
  list(@Query() query: ListReceiptVouchersQueryDto) {
    return this.receiptVouchersService.listForInvoice(query.salesInvoiceId);
  }
}
