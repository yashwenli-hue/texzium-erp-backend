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

import { CustomerGstService } from './customer-gst.service';
import { CreateCustomerGstDto } from './dto/create-customer-gst.dto';
import { UpdateCustomerGstDto } from './dto/update-customer-gst.dto';
import {
  DeactivateCustomerGstDto,
  ReactivateCustomerGstDto,
} from './dto/customer-gst-lifecycle.dto';

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

@Controller('customer-gst')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class CustomerGstController {
  constructor(
    private readonly customerGstService: CustomerGstService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ScopedRecord('customer', 'body.customerId')
  @Permissions('customers.gst.manage')
  create(@Body() body: CreateCustomerGstDto, @Req() req: AuthenticatedRequest) {
    // A GSTIN registered to a customer the caller may not see is still refused, without
    // naming that customer.
    return hideInaccessibleCustomer(this.prisma, scopeOf(req.user), () =>
      this.customerGstService.create(body, req.user?.id),
    );
  }

  @Get()
  @Permissions('customers.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.customerGstService.findAll(scopeOf(req.user));
  }

  @Get(':id')
  @ScopedRecord('gstRegistration', 'params.id')
  @Permissions('customers.view')
  findOne(@Param('id') id: string) {
    return this.customerGstService.findOne(id);
  }

  @Patch(':id')
  @ScopedRecord('gstRegistration', 'params.id')
  @Permissions('customers.gst.manage')
  update(
    @Param('id') id: string,
    @Body() body: UpdateCustomerGstDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerGstService.update(id, req.user?.id, body);
  }

  @Patch(':id/deactivate')
  @ScopedRecord('gstRegistration', 'params.id')
  @Permissions('customers.gst.manage')
  deactivate(
    @Param('id') id: string,
    @Body() body: DeactivateCustomerGstDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerGstService.deactivate(id, req.user?.id, body);
  }

  @Patch(':id/reactivate')
  @ScopedRecord('gstRegistration', 'params.id')
  @Permissions('customers.gst.manage')
  reactivate(
    @Param('id') id: string,
    @Body() body: ReactivateCustomerGstDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerGstService.reactivate(id, req.user?.id, body);
  }

  @Patch(':id/default')
  @ScopedRecord('gstRegistration', 'params.id')
  @Permissions('customers.gst.manage')
  setDefault(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.customerGstService.setDefault(id, req.user?.id);
  }
}
