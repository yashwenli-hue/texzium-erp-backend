import { Controller, Get, Param, Post } from '@nestjs/common';
import { EInvoiceIrnService } from './e-invoice-irn.service';

@Controller('e-invoice-irn')
export class EInvoiceIrnController {
  constructor(
    private readonly eInvoiceIrnService: EInvoiceIrnService,
  ) {}

  @Post('generate/:salesInvoiceId')
  generate(
    @Param('salesInvoiceId') salesInvoiceId: string,
  ) {
    return this.eInvoiceIrnService.generate(salesInvoiceId);
  }

  @Get()
  findAll() {
    return this.eInvoiceIrnService.findAll();
  }
}
