import { Module } from '@nestjs/common';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DOCUMENT_UPLOADS_ROOT, defaultUploadsRoot } from './document-storage';

@Module({
  controllers: [DocumentController],
  providers: [
    DocumentService,
    { provide: DOCUMENT_UPLOADS_ROOT, useFactory: defaultUploadsRoot },
  ],
  exports: [DocumentService],
})
export class DocumentModule {}
