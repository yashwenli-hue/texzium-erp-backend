import {
  Controller,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import { DocumentService } from './document.service';
import type { Response } from 'express';
import * as path from 'path';

@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Get()
  findAll() {
    return this.documentService.findAll();
  }

  @Get(':id/download')
  async download(@Param('id') id: string, @Res() res: Response) {
    const document = await this.documentService.findById(id);

    const fullPath = path.resolve(document.filePath);

    return res.download(fullPath);
  }
}
