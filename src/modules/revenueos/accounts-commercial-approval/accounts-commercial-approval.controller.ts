import { Body, Controller, Get, Post } from '@nestjs/common';
import { AccountsCommercialApprovalService } from './accounts-commercial-approval.service';
import { CreateAccountsCommercialApprovalDto } from './dto/create-accounts-commercial-approval.dto';

@Controller('accounts-commercial-approval')
export class AccountsCommercialApprovalController {
  constructor(
    private readonly accountsCommercialApprovalService:
      AccountsCommercialApprovalService,
  ) {}

  @Post('create')
  create(@Body() data: CreateAccountsCommercialApprovalDto) {
    return this.accountsCommercialApprovalService.create(data);
  }

  @Get()
  findAll() {
    return this.accountsCommercialApprovalService.findAll();
  }
}
