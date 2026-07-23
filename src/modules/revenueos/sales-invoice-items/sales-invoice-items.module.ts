import { Module } from '@nestjs/common';
import { SalesInvoiceItemsController } from './sales-invoice-items.controller';
import { SalesInvoiceItemsService } from './sales-invoice-items.service';

@Module({
  controllers: [SalesInvoiceItemsController],
  providers: [SalesInvoiceItemsService],
})
export class SalesInvoiceItemsModule {}
