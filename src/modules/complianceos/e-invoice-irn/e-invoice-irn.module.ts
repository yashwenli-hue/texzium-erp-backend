import { Module } from '@nestjs/common';
import { EInvoiceIrnController } from './e-invoice-irn.controller';
import { EInvoiceIrnService } from './e-invoice-irn.service';

@Module({
  controllers: [EInvoiceIrnController],
  providers: [EInvoiceIrnService],
})
export class EInvoiceIrnModule {}
