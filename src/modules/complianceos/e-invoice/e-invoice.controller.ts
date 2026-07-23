import { Controller, Post, Param } from '@nestjs/common';
import { EInvoiceService } from './e-invoice.service';

@Controller('e-invoice')
export class EInvoiceController {
  constructor(private readonly eInvoiceService: EInvoiceService) {}

  @Post(':salesInvoiceId/generate-irn')
  generateIRN(@Param('salesInvoiceId') salesInvoiceId: string) {
    return this.eInvoiceService.generateIRN(salesInvoiceId);
  }
}
