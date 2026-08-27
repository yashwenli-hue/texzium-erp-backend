import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';

import { LeadFollowupsService } from './lead-followups.service';
import { CreateFollowupDto } from './dto/create-followup.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('lead-followups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeadFollowupsController {
  constructor(
    private readonly leadFollowupsService: LeadFollowupsService,
  ) {}

  @Post()
  @Permissions('leads.followups.create')
  create(@Body() body: CreateFollowupDto) {
    return this.leadFollowupsService.create(body);
  }

  @Get()
  @Permissions('leads.followups.view')
  findAll() {
    return this.leadFollowupsService.findAll();
  }

  @Get(':leadId')
  @Permissions('leads.followups.view')
  findByLead(@Param('leadId') leadId: string) {
    return this.leadFollowupsService.findByLead(leadId);
  }

  @Patch(':id/complete')
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
  @Permissions('leads.followups.create')
  cancelFollowup(@Param('id') id: string) {
    return this.leadFollowupsService.cancelFollowup(id);
  }
}
