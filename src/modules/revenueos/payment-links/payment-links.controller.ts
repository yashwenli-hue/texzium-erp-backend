import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { PaymentLinksService } from './payment-links.service';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { RecordScopeGuard, ScopedRecord } from '../record-scope/record-scope.guard';

// The invoice must be one the caller may see (record-scope.ts); otherwise 404.
@Controller('payment-links')
@UseGuards(JwtAuthGuard, RecordScopeGuard)
export class PaymentLinksController {
  constructor(
    private readonly paymentLinksService: PaymentLinksService,
  ) {}

  @Post(':salesInvoiceId/generate')
  @ScopedRecord('salesInvoice', 'params.salesInvoiceId')
  generate(
    @Param('salesInvoiceId') salesInvoiceId: string,
  ) {
    return this.paymentLinksService.generate(
      salesInvoiceId,
    );
  }
}
