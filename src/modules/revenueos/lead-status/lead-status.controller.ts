import {
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';

import { LeadStatusService } from './lead-status.service';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('lead-status')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeadStatusController {
  constructor(
    private readonly leadStatusService: LeadStatusService,
  ) {}

  @Post()
  @Permissions('leads.status.update')
  update(@Body() body: UpdateLeadStatusDto) {
    return this.leadStatusService.update(body);
  }
}
