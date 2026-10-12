import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { ContentSharesService } from './content-shares.service';
import { ShareContentDto } from './dto/share-content.dto';

type AuthenticatedRequest = { user?: { id?: string } };

// Sharing library content with a lead, an opportunity or a customer: recording a share
// needs content.view and content.share; the share history of an item needs content.view.
@Controller('content-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContentSharesController {
  constructor(private readonly shares: ContentSharesService) {}

  @Post(':id/shares')
  @Permissions('content.view', 'content.share')
  share(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ShareContentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.shares.share(id, body, req.user?.id);
  }

  @Get(':id/shares')
  @Permissions('content.view')
  list(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.shares.listForAsset(id);
  }
}
