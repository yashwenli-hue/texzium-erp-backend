import { Controller, Get } from '@nestjs/common';
import { BalanceSheetService } from './balance-sheet.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('balance-sheet')
export class BalanceSheetController {
  constructor(
    private readonly balanceSheetService: BalanceSheetService,
  ) {}

  @Get()
  getBalanceSheet() {
    return this.balanceSheetService.getBalanceSheet();
  }
}
