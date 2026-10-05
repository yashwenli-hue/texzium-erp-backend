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

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
  ) {}

  @Post()
  @Permissions('leads.create')
  create(@Body() body: CreateLeadDto) {
    return this.leadsService.create(body);
  }

  @Get()
  @Permissions('leads.view')
  findAll(@Query() query: ListLeadsQueryDto) {
    return this.leadsService.findAll(query.includeInactive);
  }

  @Get(':id')
  @Permissions('leads.view')
  findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Post(':id/activities')
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
  @Permissions('leads.deactivate')
  reactivate(
    @Param('id') id: string,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.leadsService.reactivate(id, req.user?.id);
  }

  @Patch(':id')
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
