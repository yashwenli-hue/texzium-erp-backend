import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../../core/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { DataDeletionService } from './data-deletion.service';
import { ListDeletionsQueryDto } from './dto/list-deletions-query.dto';

// The deletion log. Read only: a tombstone is never written, changed or removed
// through the API (the deletion itself writes it, in the same transaction as the
// removal). The single snapshot holds the full record, personal data included, so
// every route is guarded by governance.deletions.view.
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
}
