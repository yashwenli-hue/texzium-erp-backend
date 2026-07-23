import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';

import { DocumentNumberSeriesController } from './document-number-series.controller';
import { DocumentNumberSeriesService } from './document-number-series.service';

import { DocumentNumberGeneratorService } from './services/document-number-generator.service';

@Module({
  imports: [DatabaseModule],

  controllers: [
    DocumentNumberSeriesController,
  ],

  providers: [
    DocumentNumberSeriesService,
    DocumentNumberGeneratorService,
  ],

  exports: [
    DocumentNumberSeriesService,
    DocumentNumberGeneratorService,
  ],
})
export class DocumentNumberSeriesModule {}
