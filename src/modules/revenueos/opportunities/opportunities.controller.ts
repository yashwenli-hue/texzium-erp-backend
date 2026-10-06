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

import { OpportunitiesService } from './opportunities.service';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { UpdateOpportunityStageDto } from './dto/update-opportunity-stage.dto';

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

  @Get(':id')
  @Permissions('opportunities.view')
  findOne(@Param('id') id: string) {
    return this.opportunitiesService.findOne(id);
  }

  // One step forward or back, or Lost. Won and Lost are final.
  @Patch(':id/stage')
  @Permissions('opportunities.edit')
  updateStage(
    @Param('id') id: string,
    @Body() body: UpdateOpportunityStageDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.opportunitiesService.updateStage(id, req.user?.id, body);
  }
}
