import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { LeadBantService } from './lead-bant.service';
import { SaveLeadBantDto } from './dto/save-lead-bant.dto';

// A lead's BANT analysis. Read with the lead (leads.view) and saved by whoever may
// edit it (leads.edit), in both cases only on a lead in the caller's record scope.
@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class LeadBantController {
  constructor(private readonly leadBantService: LeadBantService) {}

  @Get(':id/bant')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.view')
  get(@Param('id') id: string) {
    return this.leadBantService.get(id);
  }

  @Put(':id/bant')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.edit')
  save(
    @Param('id') id: string,
    @Body() body: SaveLeadBantDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.leadBantService.save(id, body, req.user?.id);
  }
}
