import { Body, Controller, Post } from '@nestjs/common';
import { BadDebtWriteOffService } from './bad-debt-writeoff.service';
import { CreateBadDebtWriteOffDto } from './dto/create-bad-debt-writeoff.dto';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('bad-debt-writeoff')
export class BadDebtWriteOffController {
  constructor(
    private readonly badDebtWriteOffService: BadDebtWriteOffService,
  ) {}

  @Post('generate')
  generate(@Body() data: CreateBadDebtWriteOffDto) {
    return this.badDebtWriteOffService.generate(data);
  }
}
