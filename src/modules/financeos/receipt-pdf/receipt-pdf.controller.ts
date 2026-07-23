import { Controller, Get, Param } from '@nestjs/common';
import { ReceiptPdfService } from './receipt-pdf.service';

@Controller('receipt-pdf')
export class ReceiptPdfController {
  constructor(
    private readonly receiptPdfService: ReceiptPdfService,
  ) {}

  @Get(':receiptVoucherId')
  generate(
    @Param('receiptVoucherId') receiptVoucherId: string,
  ) {
    return this.receiptPdfService.generate(
      receiptVoucherId,
    );
  }
}
