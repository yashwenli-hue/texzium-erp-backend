import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { DocumentRepositoryService } from './document-repository.service';
import { CreateDocumentDto } from './dto/create-document.dto';

@Controller('documents')
export class DocumentRepositoryController {
  constructor(
    private readonly documentRepositoryService: DocumentRepositoryService,
  ) {}

  @Post('upload')
  upload(@Body() data: CreateDocumentDto) {
    return this.documentRepositoryService.upload(data);
  }

  @Get()
  findAll() {
    return this.documentRepositoryService.findAll();
  }

  @Get('module/:moduleName')
  findByModule(@Param('moduleName') moduleName: string) {
    return this.documentRepositoryService.findByModule(moduleName);
  }

  @Get('reference/:referenceId')
  findByReference(@Param('referenceId') referenceId: string) {
    return this.documentRepositoryService.findByReference(referenceId);
  }
}
