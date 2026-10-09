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
import { CUSTOMER_DELETION_POLICY } from './customer-deletion.policy';

// Deleting a customer that nothing depends on (it goes to the Recycle Bin and can be
// restored). Preview first: it says what stands in the way and what would go, and gives
// the token the deletion must carry. Both routes need customers.delete (SUPER_ADMIN only
// for now); the actor is the signed-in user and is never accepted from the client.
@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomerDeletionController {
  constructor(private readonly deletions: DataDeletionService) {}

  @Get(':id/deletion-preview')
  @Permissions('customers.delete')
  preview(@Param('id') id: string) {
    return this.deletions.preview(CUSTOMER_DELETION_POLICY, id);
  }

  @Delete(':id')
  @Permissions('customers.delete')
  remove(
    @Param('id') id: string,
    @Body() body: DeleteRecordDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.deletions.delete(
      CUSTOMER_DELETION_POLICY,
      id,
      body,
      req.user?.id,
    );
  }
}
