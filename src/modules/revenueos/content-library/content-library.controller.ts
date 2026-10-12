import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { ContentLibraryService } from './content-library.service';
import { CONTENT_UPLOAD_OPTIONS, ContentUploadCleanup } from './content-upload';
import {
  ArchiveContentAssetDto,
  ContentAccessUrlDto,
  CreateContentAssetDto,
  ListContentAssetsQueryDto,
  UpdateContentAssetDto,
} from './dto/content-asset.dto';

type AuthenticatedRequest = { user?: { id?: string } };
type UploadedTemp = { path: string; originalname: string };

// The sales content library. Reading needs content.view; uploading, editing,
// versioning, archiving and restoring need content.manage. Uploads are multipart with
// one "file" part; guards run before any byte is stored.
@Controller('content-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContentLibraryController {
  constructor(private readonly library: ContentLibraryService) {}

  @Get()
  @Permissions('content.view')
  list(@Query() query: ListContentAssetsQueryDto) {
    return this.library.list(query);
  }

  @Get(':id')
  @Permissions('content.view')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.library.get(id);
  }

  @Post()
  @Permissions('content.manage')
  @UseInterceptors(
    FileInterceptor('file', CONTENT_UPLOAD_OPTIONS),
    ContentUploadCleanup,
  )
  create(
    @Body() body: CreateContentAssetDto,
    @UploadedFile() file: UploadedTemp | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.library.create(body, file, req.user?.id);
  }

  @Patch(':id')
  @Permissions('content.manage')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateContentAssetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.library.update(id, body, req.user?.id);
  }

  @Post(':id/versions')
  @Permissions('content.manage')
  @UseInterceptors(
    FileInterceptor('file', CONTENT_UPLOAD_OPTIONS),
    ContentUploadCleanup,
  )
  addVersion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedTemp | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.library.addVersion(id, file, req.user?.id);
  }

  @Post(':id/archive')
  @Permissions('content.manage')
  archive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ArchiveContentAssetDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.library.archive(id, body.reason, req.user?.id);
  }

  @Post(':id/restore')
  @Permissions('content.manage')
  restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.library.restore(id, req.user?.id);
  }

  // A signed URL (15 minutes) for viewing or downloading one version.
  @Post(':id/access-url')
  @Permissions('content.view')
  accessUrl(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ContentAccessUrlDto,
  ) {
    return this.library.accessUrl(id, body.disposition, body.version);
  }
}
