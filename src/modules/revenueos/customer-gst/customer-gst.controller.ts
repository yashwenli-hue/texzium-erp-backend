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

type AuthenticatedRequest = { user?: { id?: string } };

@Controller('customer-gst')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomerGstController {
  constructor(private readonly customerGstService: CustomerGstService) {}

  @Post()
  @Permissions('customers.gst.manage')
  create(@Body() body: CreateCustomerGstDto, @Req() req: AuthenticatedRequest) {
    return this.customerGstService.create(body, req.user?.id);
  }

  @Get()
  @Permissions('customers.view')
  findAll() {
    return this.customerGstService.findAll();
  }

  @Get(':id')
  @Permissions('customers.view')
  findOne(@Param('id') id: string) {
    return this.customerGstService.findOne(id);
  }

  @Patch(':id')
  @Permissions('customers.gst.manage')
  update(
    @Param('id') id: string,
    @Body() body: UpdateCustomerGstDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerGstService.update(id, req.user?.id, body);
  }

  @Patch(':id/deactivate')
  @Permissions('customers.gst.manage')
  deactivate(
    @Param('id') id: string,
    @Body() body: DeactivateCustomerGstDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerGstService.deactivate(id, req.user?.id, body);
  }

  @Patch(':id/reactivate')
  @Permissions('customers.gst.manage')
  reactivate(
    @Param('id') id: string,
    @Body() body: ReactivateCustomerGstDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.customerGstService.reactivate(id, req.user?.id, body);
  }

  @Patch(':id/default')
  @Permissions('customers.gst.manage')
  setDefault(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.customerGstService.setDefault(id, req.user?.id);
  }
}
