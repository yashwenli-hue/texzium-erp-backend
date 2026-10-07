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

import { CustomerMasterService } from './customer-master.service';
import { CustomerOverviewService } from './customer-overview.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  DeactivateCustomerDto,
  ReactivateCustomerDto,
} from './dto/customer-lifecycle.dto';
import { CustomerDuplicateCheckQueryDto } from './dto/customer-duplicate-check.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

type AuthenticatedRequest = { user?: { id?: string } };

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomerMasterController {
  constructor(
    private readonly customerService: CustomerMasterService,
    private readonly overviewService: CustomerOverviewService,
  ) {}

  @Post()
  @Permissions('customers.create')
  create(@Body() body: CreateCustomerDto, @Req() req: AuthenticatedRequest) {
    return this.customerService.create(body, req.user?.id);
  }

  @Get()
  @Permissions('customers.view')
  findAll() {
    return this.customerService.findAll();
  }

  // Declared before ":id" so it is not read as a customer id.
  @Get('duplicate-check')
  @Permissions('customers.view')
  duplicateCheck(@Query() query: CustomerDuplicateCheckQueryDto) {
    return this.customerService.duplicateCheck(query);
  }

  @Get(':id')
  @Permissions('customers.view')
  findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
  }

  // The customer's whole quote-to-cash chain, followed by id, in one read.
  @Get(':id/overview')
  @Permissions('customers.view')
  overview(@Param('id') id: string) {
    return this.overviewService.get(id);
  }

  @Get(':id/events')
  @Permissions('customers.view')
  findEvents(@Param('id') id: string) {
    return this.customerService.findEvents(id);
  }

  @Patch(':id')
  @Permissions('customers.edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerService.update(id, req.user?.id, body);
  }

  @Patch(':id/deactivate')
  @Permissions('customers.deactivate')
  deactivate(
    @Param('id') id: string,
    @Body() body: DeactivateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerService.deactivate(id, req.user?.id, body);
  }

  @Patch(':id/reactivate')
  @Permissions('customers.deactivate')
  reactivate(
    @Param('id') id: string,
    @Body() body: ReactivateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerService.reactivate(id, req.user?.id, body);
  }
}
