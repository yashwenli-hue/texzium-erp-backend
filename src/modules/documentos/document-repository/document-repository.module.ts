import { Module } from '@nestjs/common';
import { DocumentRepositoryController } from './document-repository.controller';
import { DocumentRepositoryService } from './document-repository.service';

@Module({
  controllers: [DocumentRepositoryController],
  providers: [DocumentRepositoryService],
})
export class DocumentRepositoryModule {}
