import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { LeadAssignmentsService } from './lead-assignments.service';
import { AssignLeadDto } from './dto/assign-lead.dto';
import { UnassignLeadDto } from './dto/unassign-lead.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

type AuthenticatedRequest = { user?: { id?: string } };

@Controller('lead-assignments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeadAssignmentsController {
  constructor(
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  @Post()
  @Permissions('leads.assign')
  assign(@Body() body: AssignLeadDto) {
    return this.leadAssignmentsService.assign(body);
  }

  @Patch(':id/qualify')
  @Permissions('leads.qualify')
  qualifyLead(
    @Param('id') id: string,
    @Body() body: { salesUserId: string },
  ) {
    return this.leadAssignmentsService.qualifyLead(
      id,
      body.salesUserId,
    );
  }

  @Patch(':id/reject')
  @Permissions('leads.reject')
  rejectLead(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.leadAssignmentsService.rejectLead(
      id,
      body.reason,
    );
  }

  // Same permission as assigning: undoing an assignment is part of assigning leads.
  @Patch(':id/unassign')
  @Permissions('leads.assign')
  unassign(
    @Param('id') id: string,
    @Body() body: UnassignLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadAssignmentsService.unassign(id, body, req.user?.id);
  }
}
