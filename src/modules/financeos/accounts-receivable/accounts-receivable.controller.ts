import { Body, Controller, Get, Post } from '@nestjs/common';
import { AccountsReceivableService } from './accounts-receivable.service';
import { CreateAccountsReceivableDto } from './dto/create-accounts-receivable.dto';

@Controller('accounts-receivable')
export class AccountsReceivableController {
  constructor(
    private readonly accountsReceivableService: AccountsReceivableService,
  ) {}

  @Post()
  create(@Body() body: CreateAccountsReceivableDto) {
    return this.accountsReceivableService.create(body);
  }

  @Get()
  findAll() {
    return this.accountsReceivableService.findAll();
  }
}
