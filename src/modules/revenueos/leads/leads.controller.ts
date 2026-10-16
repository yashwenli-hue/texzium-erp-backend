import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { LeadsService } from './leads.service';

import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';
import { DeactivateLeadDto } from './dto/deactivate-lead.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { SearchLeadsQueryDto } from './dto/search-leads-query.dto';
import { LeadDuplicateCheckQueryDto } from './dto/lead-duplicate-check.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { RecordScopeGuard, ScopedRecord } from '../record-scope/record-scope.guard';
import { scopeOf } from '../record-scope/record-scope';

@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
  ) {}

  @Post()
  @Permissions('leads.create')
  create(
    @Body() body: CreateLeadDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.leadsService.create(body, req.user?.id);
  }

  @Get()
  @Permissions('leads.view')
  findAll(
    @Query() query: ListLeadsQueryDto,
    @Req() req: { user?: { id?: string; permissions?: unknown } },
  ) {
    return this.leadsService.findAll(query.includeInactive, scopeOf(req.user));
  }

  // Declared before ":id" so it is not read as a lead id.
  @Get('search')
  @Permissions('leads.view')
  search(
    @Query() query: SearchLeadsQueryDto,
    @Req() req: { user?: { id?: string; permissions?: unknown } },
  ) {
    return this.leadsService.search(query, scopeOf(req.user));
  }

  // Declared before ":id" so it is not read as a lead id.
  @Get('duplicate-check')
  @Permissions('leads.view')
  duplicateCheck(
    @Query() query: LeadDuplicateCheckQueryDto,
    @Req() req: { user?: { id?: string; permissions?: unknown } },
  ) {
    return this.leadsService.duplicateCheck(query, scopeOf(req.user));
  }

  @Get(':id/duplicates')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.view')
  duplicatesOf(
    @Param('id') id: string,
    @Req() req: { user?: { id?: string; permissions?: unknown } },
  ) {
    return this.leadsService.duplicatesOf(id, scopeOf(req.user));
  }

  @Get(':id')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.view')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Post(':id/activities')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.edit')
  createActivity(
    @Param('id') id: string,
    @Body() body: CreateLeadActivityDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.leadsService.createActivity(
      id,
      req.user?.id,
      body,
    );
  }

  // Takes a lead out of active work (reason required). One permission covers
  // both deactivating and reactivating.
  @Patch(':id/deactivate')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.deactivate')
  deactivate(
    @Param('id') id: string,
    @Body() body: DeactivateLeadDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.leadsService.deactivate(
      id,
      req.user?.id,
      body.reason,
    );
  }

  @Patch(':id/reactivate')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.deactivate')
  reactivate(
    @Param('id') id: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.leadsService.reactivate(id, req.user?.id);
  }

  @Patch(':id')
  @ScopedRecord('lead', 'params.id')
  @Permissions('leads.edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateLeadDto,
  ) {
    return this.leadsService.update(
      id,
      body,
    );
  }
}
