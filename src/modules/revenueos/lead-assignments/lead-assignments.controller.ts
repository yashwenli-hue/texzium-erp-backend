import {
  Body,
  Controller,
  Post,
  Patch,
  Param,
} from '@nestjs/common';
import { LeadAssignmentsService } from './lead-assignments.service';
import { AssignLeadDto } from './dto/assign-lead.dto';

@Controller('lead-assignments')
export class LeadAssignmentsController {
  constructor(
    private readonly leadAssignmentsService: LeadAssignmentsService,
  ) {}

  @Post()
  assign(@Body() body: AssignLeadDto) {
    return this.leadAssignmentsService.assign(body);
  }

  @Patch(':id/qualify')
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
  rejectLead(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.leadAssignmentsService.rejectLead(
      id,
      body.reason,
    );
  }
}
