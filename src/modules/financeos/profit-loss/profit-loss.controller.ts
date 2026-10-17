import { Controller, Get } from '@nestjs/common';
import { ProfitLossService } from './profit-loss.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('profit-loss')
export class ProfitLossController {
  constructor(
    private readonly profitLossService: ProfitLossService,
  ) {}

  @Get()
  getProfitLoss() {
    return this.profitLossService.getProfitLoss();
  }
}
