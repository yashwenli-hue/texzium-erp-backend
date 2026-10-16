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
import { LinkOpportunityCustomerDto } from './dto/link-opportunity-customer.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { scopeOf } from '../record-scope/record-scope';

@Controller('opportunities')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class OpportunitiesController {
  constructor(private readonly opportunitiesService: OpportunitiesService) {}

  @Post()
  @ScopedRecord('lead', 'body.leadId')
  @ScopedRecord('customer', 'body.customerId')
  @Permissions('opportunities.create')
  create(
    @Body() body: CreateOpportunityDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.opportunitiesService.create(body, req.user?.id);
  }

  @Get()
  @Permissions('opportunities.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.opportunitiesService.findAll(scopeOf(req.user));
  }

  @Get(':id')
  @ScopedRecord('opportunity', 'params.id')
  @Permissions('opportunities.view')
  findOne(@Param('id') id: string) {
    return this.opportunitiesService.findOne(id);
  }

  // One step forward or back, or Lost. Won and Lost are final.
  @Patch(':id/stage')
  @ScopedRecord('opportunity', 'params.id')
  @Permissions('opportunities.edit')
  updateStage(
    @Param('id') id: string,
    @Body() body: UpdateOpportunityStageDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.opportunitiesService.updateStage(id, req.user?.id, body);
  }

  // Links the opportunity to a customer, changes it, or (null) removes it.
  // Refused once the opportunity has a quotation.
  @Patch(':id/customer')
  @ScopedRecord('opportunity', 'params.id')
  @ScopedRecord('customer', 'body.customerId')
  @Permissions('opportunities.edit')
  linkCustomer(
    @Param('id') id: string,
    @Body() body: LinkOpportunityCustomerDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.opportunitiesService.linkCustomer(id, req.user?.id, body);
  }
}
