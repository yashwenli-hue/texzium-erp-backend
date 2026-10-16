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
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { scopeOf } from '../record-scope/record-scope';
import { hideInaccessibleCustomer } from '../record-scope/hide-inaccessible';
import { PrismaService } from '../../../core/database/prisma.service';

type AuthenticatedRequest = { user?: { id?: string; permissions?: unknown } };

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class CustomerMasterController {
  constructor(
    private readonly customerService: CustomerMasterService,
    private readonly overviewService: CustomerOverviewService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @Permissions('customers.create')
  create(@Body() body: CreateCustomerDto, @Req() req: AuthenticatedRequest) {
    return hideInaccessibleCustomer(this.prisma, scopeOf(req.user), () =>
      this.customerService.create(body, req.user?.id),
    );
  }

  @Get()
  @Permissions('customers.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.customerService.findAll(scopeOf(req.user));
  }

  // Declared before ":id" so it is not read as a customer id.
  @Get('duplicate-check')
  @Permissions('customers.view')
  duplicateCheck(
    @Query() query: CustomerDuplicateCheckQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerService.duplicateCheck(query, scopeOf(req.user));
  }

  @Get(':id')
  @ScopedRecord('customer', 'params.id')
  @Permissions('customers.view')
  findOne(@Param('id') id: string) {
    return this.customerService.findOne(id);
  }

  // The customer's whole quote-to-cash chain, followed by id, in one read.
  @Get(':id/overview')
  @ScopedRecord('customer', 'params.id')
  @Permissions('customers.view')
  overview(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.overviewService.get(id, scopeOf(req.user));
  }

  @Get(':id/events')
  @ScopedRecord('customer', 'params.id')
  @Permissions('customers.view')
  findEvents(@Param('id') id: string) {
    return this.customerService.findEvents(id);
  }

  @Patch(':id')
  @ScopedRecord('customer', 'params.id')
  @Permissions('customers.edit')
  update(
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return hideInaccessibleCustomer(this.prisma, scopeOf(req.user), () =>
      this.customerService.update(id, req.user?.id, body),
    );
  }

  @Patch(':id/deactivate')
  @ScopedRecord('customer', 'params.id')
  @Permissions('customers.deactivate')
  deactivate(
    @Param('id') id: string,
    @Body() body: DeactivateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerService.deactivate(id, req.user?.id, body);
  }

  @Patch(':id/reactivate')
  @ScopedRecord('customer', 'params.id')
  @Permissions('customers.deactivate')
  reactivate(
    @Param('id') id: string,
    @Body() body: ReactivateCustomerDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerService.reactivate(id, req.user?.id, body);
  }
}
