import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AccountsCommercialApprovalService } from './accounts-commercial-approval.service';
import { CreateAccountsCommercialApprovalDto } from './dto/create-accounts-commercial-approval.dto';

import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';

@Controller('accounts-commercial-approval')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountsCommercialApprovalController {
  constructor(
    private readonly accountsCommercialApprovalService: AccountsCommercialApprovalService,
  ) {}

  // The approver is the signed-in user; it is never taken from the request body.
  @Post('create')
  @Permissions('salesorders.commercialapproval.approve')
  create(
    @Body() data: CreateAccountsCommercialApprovalDto,
    @Req() req: { user?: { id?: string } },
  ) {
    return this.accountsCommercialApprovalService.create(data, req.user?.id);
  }

  @Get()
  @Permissions('salesorders.commercialapproval.view')
  findAll() {
    return this.accountsCommercialApprovalService.findAll();
  }
}
