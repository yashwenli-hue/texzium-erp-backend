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
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { ReviseQuotationDto } from './dto/revise-quotation.dto';
import { ApproveQuotationDto } from './dto/approve-quotation.dto';
import { RejectQuotationDto } from './dto/reject-quotation.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

type AuthenticatedRequest = { user?: { id?: string } };

@Controller('quotations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Post()
  @Permissions('quotations.create')
  create(@Body() body: CreateQuotationDto, @Req() req: AuthenticatedRequest) {
    return this.quotationsService.create(body, req.user?.id);
  }

  @Get()
  @Permissions('quotations.view')
  findAll() {
    return this.quotationsService.findAll();
  }

  @Get(':id/events')
  @Permissions('quotations.view')
  findEvents(@Param('id') id: string) {
    return this.quotationsService.findEvents(id);
  }

  // Revises the taxable amount; the backend recomputes GST and the total. The
  // actor is the signed-in user.
  @Patch(':id/revise')
  @Permissions('quotations.edit')
  revise(
    @Param('id') id: string,
    @Body() body: ReviseQuotationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quotationsService.revise(id, req.user?.id, body);
  }

  @Patch(':id/approve')
  @Permissions('quotations.approve')
  approve(
    @Param('id') id: string,
    @Body() body: ApproveQuotationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quotationsService.approve(id, req.user?.id, body);
  }

  @Patch(':id/reject')
  @Permissions('quotations.reject')
  reject(
    @Param('id') id: string,
    @Body() body: RejectQuotationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.quotationsService.reject(id, req.user?.id, body);
  }

  // Still the legacy conversion, untouched here: it is retired in the
  // Proforma and legacy-closure checkpoint. It declares no permission, so it
  // needs only a signed-in user.
  @Post(':id/convert')
  convertToSalesOrder(@Param('id') id: string) {
    return this.quotationsService.convertToSalesOrder(id);
  }
}
