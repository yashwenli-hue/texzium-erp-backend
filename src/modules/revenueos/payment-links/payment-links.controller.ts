import { Controller, Post, Param } from '@nestjs/common';
import { PaymentLinksService } from './payment-links.service';

@Controller('payment-links')
export class PaymentLinksController {
  constructor(
    private readonly paymentLinksService: PaymentLinksService,
  ) {}

  @Post(':salesInvoiceId/generate')
  generate(
    @Param('salesInvoiceId') salesInvoiceId: string,
  ) {
    return this.paymentLinksService.generate(
      salesInvoiceId,
    );
  }
}
