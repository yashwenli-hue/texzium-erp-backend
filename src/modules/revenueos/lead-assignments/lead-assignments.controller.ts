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
import { QualifyLeadDto } from './dto/qualify-lead.dto';
import { RejectLeadDto } from './dto/reject-lead.dto';
import { UnassignLeadDto } from './dto/unassign-lead.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

// The actor of every action here is the authenticated user (req.user, set by the JWT
// guard); no body carries an actor.
type AuthenticatedRequest = { user?: { id?: string } };

@Controller('lead-assignments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeadAssignmentsController {
  constructor(
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  @Post()
  @Permissions('leads.assign')
  assign(@Body() body: AssignLeadDto, @Req() req: AuthenticatedRequest) {
    return this.leadAssignmentsService.assign(body, req.user?.id);
  }

  @Patch(':id/qualify')
  @Permissions('leads.qualify')
  qualifyLead(
    @Param('id') id: string,
    @Body() body: QualifyLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadAssignmentsService.qualifyLead(id, body, req.user?.id);
  }

  @Patch(':id/reject')
  @Permissions('leads.reject')
  rejectLead(
    @Param('id') id: string,
    @Body() body: RejectLeadDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.leadAssignmentsService.rejectLead(id, body, req.user?.id);
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
