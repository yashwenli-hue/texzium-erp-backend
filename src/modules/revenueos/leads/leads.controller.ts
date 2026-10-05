import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { LeadsService } from './leads.service';

import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { CreateLeadActivityDto } from './dto/create-lead-activity.dto';

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
  findAll() {
    return this.leadsService.findAll();
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
