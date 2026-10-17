import { Controller, Get } from '@nestjs/common';
import { TrialBalanceService } from './trial-balance.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('trial-balance')
export class TrialBalanceController {
  constructor(
    private readonly trialBalanceService: TrialBalanceService,
  ) {}

  @Get()
  getTrialBalance() {
    return this.trialBalanceService.getTrialBalance();
  }
}
