import { Body, Controller, Post } from '@nestjs/common';
import { LeadStatusService } from './lead-status.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

@Controller('lead-status')
export class LeadStatusController {
  constructor(
    private readonly leadStatusService: LeadStatusService,
  ) {}

  @Post()
  update(@Body() body: UpdateLeadStatusDto) {
    return this.leadStatusService.update(body);
  }
}
