import { Controller, Get } from '@nestjs/common';
import { ForecastingEngineService } from './forecasting-engine.service';
import { FinanceRecords } from '../../revenueos/record-scope/finance-visibility.guard';

@FinanceRecords()
@Controller('forecasting-engine')
export class ForecastingEngineController {
  constructor(
    private readonly forecastingEngineService: ForecastingEngineService,
  ) {}

  @Get()
  forecast() {
    return this.forecastingEngineService.forecast();
  }
}
