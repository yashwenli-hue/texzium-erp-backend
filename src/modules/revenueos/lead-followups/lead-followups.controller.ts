import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
} from '@nestjs/common';
import { LeadFollowupsService } from './lead-followups.service';
import { CreateFollowupDto } from './dto/create-followup.dto';

@Controller('lead-followups')
export class LeadFollowupsController {
  constructor(
    private readonly leadFollowupsService: LeadFollowupsService,
  ) {}

  @Post()
  create(@Body() body: CreateFollowupDto) {
    return this.leadFollowupsService.create(body);
  }

  @Get()
  findAll() {
    return this.leadFollowupsService.findAll();
  }

  
  @Get(':leadId')
findByLead(@Param('leadId') leadId: string) {
  return this.leadFollowupsService.findByLead(
    leadId,
  );
}

@Patch(':id/complete')
completeFollowup(@Param('id') id: string) {
  return this.leadFollowupsService.completeFollowup(
    id,
  );
}

@Patch(':id/reschedule')
rescheduleFollowup(
  @Param('id') id: string,
  @Body() body: { followupDate: string },
) {
  return this.leadFollowupsService.rescheduleFollowup(
    id,
    body.followupDate,
  );
}



}
