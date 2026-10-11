import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { DocumentService } from './document.service';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';

import { JwtAuthGuard } from '../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/guards/permissions.guard';
import { Permissions } from '../../core/decorators/permissions.decorator';

// Documents are registered by the server itself (e.g. commissioning certificates);
// there is no upload route. Listing and downloading need documents.view.
@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Get()
  @Permissions('documents.view')
  findAll(@Query() query: ListDocumentsQueryDto) {
    return this.documentService.findAll(query);
  }

  @Get(':id/download')
  @Permissions('documents.view')
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documentService.openForDownload(id);

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');

    return new StreamableFile(file.stream, {
      type: file.contentType,
      length: file.size,
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }
}
