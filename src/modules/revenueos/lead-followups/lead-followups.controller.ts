import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';

import { LeadFollowupsService } from './lead-followups.service';
import { CreateFollowupDto } from './dto/create-followup.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { RecordScopeGuard, ScopedRecord } from '../record-scope/record-scope.guard';
import { scopeOf } from '../record-scope/record-scope';

@Controller('lead-followups')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class LeadFollowupsController {
  constructor(
    private readonly leadFollowupsService: LeadFollowupsService,
  ) {}

  @Post()
  @ScopedRecord('lead', 'body.leadId')
  @Permissions('leads.followups.create')
  create(@Body() body: CreateFollowupDto) {
    return this.leadFollowupsService.create(body);
  }

  @Get()
  @Permissions('leads.followups.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.leadFollowupsService.findAll(scopeOf(req.user));
  }

  // Declared before ':leadId' so "mine" and "calendar" are not read as a lead id.
  @Get('mine')
  @Permissions('leads.followups.view')
  mine(
    @Req() req: { user?: { id?: string } },
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!req.user?.id) throw new UnauthorizedException('Authenticated user required.');
    return this.leadFollowupsService.mine(req.user.id, from, to);
  }

  @Get('calendar')
  @Permissions('leads.followups.view')
  calendar(
    @Req() req: { user?: { id?: string; permissions?: unknown } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('ownerId') ownerId?: string,
  ) {
    return this.leadFollowupsService.calendar(scopeOf(req.user), from, to, ownerId);
  }

  @Get(':leadId')
  @ScopedRecord('lead', 'params.leadId')
  @Permissions('leads.followups.view')
  findByLead(@Param('leadId') leadId: string) {
    return this.leadFollowupsService.findByLead(leadId);
  }

  @Patch(':id/complete')
  @ScopedRecord('followup', 'params.id')
  @Permissions('leads.followups.create')
  completeFollowup(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    return this.leadFollowupsService.completeFollowup(
      id,
      req.user.id,
    );
  }

  @Patch(':id/reschedule')
  @ScopedRecord('followup', 'params.id')
  @Permissions('leads.followups.create')
  rescheduleFollowup(
    @Param('id') id: string,
    @Body() body: { followupDate: string },
  ) {
    return this.leadFollowupsService.rescheduleFollowup(
      id,
      body.followupDate,
    );
  }

  @Patch(':id/cancel')
  @ScopedRecord('followup', 'params.id')
  @Permissions('leads.followups.create')
  cancelFollowup(@Param('id') id: string) {
    return this.leadFollowupsService.cancelFollowup(id);
  }
}
