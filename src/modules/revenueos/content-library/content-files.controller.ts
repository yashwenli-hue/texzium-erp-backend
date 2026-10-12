import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from '../../../core/decorators/public.decorator';
import { ContentLibraryService } from './content-library.service';
import { ContentStorage } from './content-storage';
import { parseByteRange, verifyContentAccess } from './content-access';
import { ContentFileQueryDto } from './dto/content-asset.dto';

export const CONTENT_LINK_INVALID = 'This link is invalid or has expired.';

// The one public route of the content library: a signed, expiring URL issued by
// POST /content-assets/:id/access-url to a signed-in user with content.view. The
// signature is checked before anything is looked up, so an unsigned request learns
// nothing (not even whether the file exists). Single byte ranges are honoured (206),
// so videos can be played and seeked.
@Controller('content-files')
export class ContentFilesController {
  private readonly logger = new Logger(ContentFilesController.name);

  constructor(
    private readonly library: ContentLibraryService,
    private readonly storage: ContentStorage,
  ) {}

  @Public()
  @Get(':fileId')
  async serve(
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @Query() query: ContentFileQueryDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const disposition = verifyContentAccess(fileId, query);
    if (!disposition) throw new ForbiddenException(CONTENT_LINK_INVALID);

    const file = await this.library.fileForAccess(fileId);
    if (!file) throw new NotFoundException('This file is not available.');
    const size = await this.storage.sizeOf(file.storageKey);
    if (size === null) {
      this.logger.error(
        `Content file ${fileId} is missing from content storage.`,
      );
      throw new NotFoundException('This file is not available.');
    }

    const remaining = Math.max(
      0,
      Number(query.exp) - Math.floor(Date.now() / 1000),
    );
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${file.fileName}"`,
    );
    res.setHeader(
      'Cache-Control',
      `private, max-age=${remaining}, no-transform`,
    );
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Accept-Ranges', 'bytes');

    const range = parseByteRange(req.headers.range, size);
    if (range.kind === 'unsatisfiable') {
      res.status(416).setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    if (range.kind === 'partial') {
      res.status(206);
      res.setHeader(
        'Content-Range',
        `bytes ${range.start}-${range.end}/${size}`,
      );
      res.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      res.status(200);
      res.setHeader('Content-Length', String(size));
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = this.storage.stream(
      file.storageKey,
      range.kind === 'partial'
        ? { start: range.start, end: range.end }
        : undefined,
    );
    stream.on('error', (error) => {
      this.logger.error(
        `Reading content file ${fileId} failed: ${String(error)}`,
      );
      res.destroy(error);
    });
    stream.pipe(res);
  }
}
