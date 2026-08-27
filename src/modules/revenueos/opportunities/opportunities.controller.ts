import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';

import { OpportunitiesService } from './opportunities.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('opportunities')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OpportunitiesController {
  constructor(
    private readonly opportunitiesService: OpportunitiesService,
  ) {}

  @Post()
  @Permissions('opportunities.create')
  create(@Body() body: CreateOpportunityDto) {
    return this.opportunitiesService.create(body);
  }

  @Get()
  @Permissions('opportunities.view')
  findAll() {
    return this.opportunitiesService.findAll();
  }
}
