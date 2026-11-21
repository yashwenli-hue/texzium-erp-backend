import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { LeadQuotationsService } from './lead-quotations.service';

// The quotations made on a lead, without prices: readable by anyone who may see the
// lead (leads.view, the lead in their record scope), e.g. the Pre-Sales person who
// handled it, who has no quotations.view and so never sees commercial terms.
@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class LeadQuotationsController {
  constructor(private readonly leadQuotationsService: LeadQuotationsService) {}

  @Get(':id/quotations')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.view')
  forLead(@Param('id') id: string) {
    return this.leadQuotationsService.forLead(id);
  }
}
