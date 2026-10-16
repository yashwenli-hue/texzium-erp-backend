import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { LeadStatusService } from './lead-status.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { RecordScopeGuard, ScopedRecord } from '../record-scope/record-scope.guard';

@Controller('lead-status')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class LeadStatusController {
  constructor(
    private readonly leadStatusService: LeadStatusService,
  ) {}

  @Post()
  @ScopedRecord('lead', 'body.leadId')
  @Permissions('leads.status.update')
  update(
    @Body() body: UpdateLeadStatusDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.leadStatusService.update(body, req.user?.id);
  }
}
