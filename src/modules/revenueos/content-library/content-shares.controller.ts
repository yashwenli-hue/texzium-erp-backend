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
import { PrismaService } from '../../../core/database/prisma.service';
import { assertVisible, scopeOf } from '../record-scope/record-scope';

type AuthenticatedRequest = { user?: { id?: string; permissions?: unknown } };

// Sharing library content with a lead, an opportunity or a customer: recording a share
// needs content.view and content.share; the share history of an item needs content.view.
@Controller('content-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContentSharesController {
  constructor(
    private readonly shares: ContentSharesService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':id/shares')
  @Permissions('content.view', 'content.share')
  share(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: ShareContentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.shareIfVisible(id, body, req);
  }

  @Get(':id/shares')
  @Permissions('content.view')
  list(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.shares.listForAsset(id, scopeOf(req.user));
  }

  // The lead, opportunity or customer must be one the caller may see (404 otherwise, as
  // for an id that does not exist).
  private async shareIfVisible(
    id: string,
    body: ShareContentDto,
    req: AuthenticatedRequest,
  ) {
    const kind = SHARE_TARGET_KIND[body.targetType];
    if (kind)
      await assertVisible(this.prisma, scopeOf(req.user), kind, body.targetId);
    return this.shares.share(id, body, req.user?.id);
  }
}

const SHARE_TARGET_KIND: Record<string, 'lead' | 'opportunity' | 'customer'> = {
  LEAD: 'lead',
  OPPORTUNITY: 'opportunity',
  CUSTOMER: 'customer',
};
