import {
  Body,
  Controller,
  Delete,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { ContentUploadsService } from './content-uploads.service';
import { ChunkQueryDto, StartUploadDto } from './dto/content-upload.dto';

type AuthenticatedRequest = Request & { user?: { id?: string } };

// Uploading a file in pieces of at most 4 MB (content.manage): start, send each piece
// at the offset the upload expects, then create the content item or version with the
// upload id. Pieces are sent as application/octet-stream.
@Controller('content-uploads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContentUploadsController {
  constructor(private readonly uploads: ContentUploadsService) {}

  @Post()
  @Permissions('content.manage')
  start(@Body() body: StartUploadDto, @Req() req: AuthenticatedRequest) {
    return this.uploads.start(req.user?.id, body.fileName, body.sizeBytes);
  }

  @Put(':id/chunks')
  @Permissions('content.manage')
  chunk(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ChunkQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.uploads.appendChunk(id, req.user?.id, query.offset, req);
  }

  @Delete(':id')
  @Permissions('content.manage')
  cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.uploads.cancel(id, req.user?.id);
  }
}
