import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';

import { Permissions } from '../../../core/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { DataDeletionService } from '../data-governance/data-deletion.service';
import { DeleteRecordDto } from '../data-governance/dto/delete-record.dto';
import { LEAD_DELETION_POLICY } from './lead-deletion.policy';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';

// Permanent deletion of a lead that never had real work done on it. The preview says
// what stands in the way and what would be removed, and gives the token the deletion
// must carry. Both routes need leads.delete (SUPER_ADMIN only for now); the actor is
// the signed-in user and is never accepted from the client.
@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class LeadDeletionController {
  constructor(private readonly deletions: DataDeletionService) {}

  @Get(':id/deletion-preview')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.delete')
  preview(@Param('id') id: string) {
    return this.deletions.preview(LEAD_DELETION_POLICY, id);
  }

  @Delete(':id')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.delete')
  remove(
    @Param('id') id: string,
    @Body() body: DeleteRecordDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.deletions.delete(LEAD_DELETION_POLICY, id, body, req.user?.id);
  }
}
