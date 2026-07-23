import { Module } from '@nestjs/common';
import { EInvoiceController } from './e-invoice.controller';
import { EInvoiceService } from './e-invoice.service';

@Module({
  controllers: [EInvoiceController],
  providers: [EInvoiceService],
})
export class EInvoiceModule {}
