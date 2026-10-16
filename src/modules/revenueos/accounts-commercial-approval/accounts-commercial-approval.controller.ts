import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AccountsCommercialApprovalService } from './accounts-commercial-approval.service';
import { CreateAccountsCommercialApprovalDto } from './dto/create-accounts-commercial-approval.dto';
import { RetractAccountsCommercialApprovalDto } from './dto/retract-accounts-commercial-approval.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import {
  RecordScopeGuard,
  ScopedRecord,
} from '../record-scope/record-scope.guard';
import { scopeOf } from '../record-scope/record-scope';

@Controller('accounts-commercial-approval')
@UseGuards(JwtAuthGuard, PermissionsGuard, RecordScopeGuard)
export class AccountsCommercialApprovalController {
  constructor(
    private readonly accountsCommercialApprovalService: AccountsCommercialApprovalService,
  ) {}

  // The approver is the signed-in user; it is never taken from the request body.
  @Post('create')
  @ScopedRecord('salesOrder', 'body.salesOrderId')
  @Permissions('salesorders.commercialapproval.approve')
  create(
    @Body() data: CreateAccountsCommercialApprovalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.accountsCommercialApprovalService.create(data, req.user?.id);
  }

  // Undoes an approval. The actor is the signed-in user.
  @Post(':id/retract')
  @ScopedRecord('commercialApproval', 'params.id')
  @HttpCode(HttpStatus.OK)
  @Permissions('salesorders.commercialapproval.retract')
  retract(
    @Param('id') id: string,
    @Body() data: RetractAccountsCommercialApprovalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.accountsCommercialApprovalService.retract(
      id,
      req.user?.id,
      data,
    );
  }

  @Get()
  @Permissions('salesorders.commercialapproval.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.accountsCommercialApprovalService.findAll(scopeOf(req.user));
  }
}
