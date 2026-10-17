import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../core/guards/permissions.guard';
import { Permissions } from '../../../core/decorators/permissions.decorator';
import { AccountsReceivableService } from './accounts-receivable.service';
import { CreateAccountsReceivableDto } from './dto/create-accounts-receivable.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';
import { financeScopeOf } from '../../revenueos/record-scope/record-scope';

// Receivables are financial records: the list shows every receivable to people with
// finance visibility and, to everyone else, only those of invoices they may see.
// The list also needs invoices.view (both checks, as everywhere). Creating one directly
// is a finance action.
@Controller('accounts-receivable')
export class AccountsReceivableController {
  constructor(
    private readonly accountsReceivableService: AccountsReceivableService,
  ) {}

  @Post()
  @FinanceRecords()
  create(@Body() body: CreateAccountsReceivableDto) {
    return this.accountsReceivableService.create(body);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('invoices.view')
  findAll(@Req() req: { user?: { id?: string; permissions?: unknown } }) {
    return this.accountsReceivableService.findAll(financeScopeOf(req.user));
  }
}
