import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { Permissions } from '../../../core/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { DataDeletionService } from './data-deletion.service';
import { ListDeletionsQueryDto } from './dto/list-deletions-query.dto';
import { RestoreRecordDto } from './dto/restore-record.dto';

// The deletion log and recycle bin.
//
// Reading needs governance.deletions.view (a tombstone's snapshot holds the full record,
// personal data included). Restoring and purging name the record (and the restore preview
// describes it), so each of those routes needs governance.deletions.view AND its own
// permission (governance.deletions.restore / governance.deletions.purge): nobody restores or
// erases a record they are not allowed to look at. The permissions are checked one by one and
// never implied by one another, so a dedicated governance role can be given any of them.
//
// A tombstone is never written, edited or removed through the API except by those two
// lifecycle actions: there is no create, update or delete route (the deletion itself writes
// it, in the same transaction as the removal). The actor is always the signed-in user. A
// purged tombstone is reached by its own id only: it holds no original record id.
@Controller('data-deletions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DataDeletionsController {
  constructor(private readonly deletions: DataDeletionService) {}

  @Get()
  @Permissions('governance.deletions.view')
  list(@Query() query: ListDeletionsQueryDto) {
    return this.deletions.list(query);
  }

  @Get(':id')
  @Permissions('governance.deletions.view')
  findOne(@Param('id') id: string) {
    return this.deletions.findOne(id);
  }

  @Get(':id/restore-preview')
  @Permissions('governance.deletions.view', 'governance.deletions.restore')
  restorePreview(@Param('id') id: string) {
    return this.deletions.restorePreview(id);
  }

  @Post(':id/restore')
  @Permissions('governance.deletions.view', 'governance.deletions.restore')
  restore(
    @Param('id') id: string,
    @Body() body: RestoreRecordDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.deletions.restore(id, body, req.user?.id);
  }

  @Post(':id/purge')
  @Permissions('governance.deletions.view', 'governance.deletions.purge')
  purge(@Param('id') id: string, @Req() req: { user?: { id?: string } }) {
    return this.deletions.purge(id, req.user?.id);
  }
}
