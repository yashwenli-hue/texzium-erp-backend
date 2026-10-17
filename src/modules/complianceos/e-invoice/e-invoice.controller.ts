import { Controller, Post, Param } from '@nestjs/common';
import { EInvoiceService } from './e-invoice.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('e-invoice')
export class EInvoiceController {
  constructor(private readonly eInvoiceService: EInvoiceService) {}

  @Post(':salesInvoiceId/generate-irn')
  generateIRN(@Param('salesInvoiceId') salesInvoiceId: string) {
    return this.eInvoiceService.generateIRN(salesInvoiceId);
  }
}
