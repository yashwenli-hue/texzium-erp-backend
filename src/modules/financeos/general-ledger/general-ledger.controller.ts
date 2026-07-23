import { Controller, Get, Param } from '@nestjs/common';
import { GeneralLedgerService } from './general-ledger.service';

@Controller('general-ledger')
export class GeneralLedgerController {
  constructor(
    private readonly generalLedgerService: GeneralLedgerService,
  ) {}

  @Get(':accountId')
  getLedger(@Param('accountId') accountId: string) {
    return this.generalLedgerService.getLedger(accountId);
  }
}
