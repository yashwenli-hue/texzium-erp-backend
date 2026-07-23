import { Module } from '@nestjs/common';

import { SalesInvoicesController } from './sales-invoices.controller';
import { SalesInvoicesService } from './sales-invoices.service';

import { DocumentNumberSeriesModule } from '../../adminos/document-number-series/document-number-series.module';

@Module({
  imports: [
    DocumentNumberSeriesModule,
  ],

  controllers: [
    SalesInvoicesController,
  ],

  providers: [
    SalesInvoicesService,
  ],

  exports: [
    SalesInvoicesService,
  ],
})
export class SalesInvoicesModule {}
