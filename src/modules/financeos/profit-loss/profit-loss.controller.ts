import { Controller, Get } from '@nestjs/common';
import { ProfitLossService } from './profit-loss.service';

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
