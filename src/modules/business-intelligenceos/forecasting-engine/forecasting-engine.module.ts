import { Module } from '@nestjs/common';
import { ForecastingEngineController } from './forecasting-engine.controller';
import { ForecastingEngineService } from './forecasting-engine.service';

@Module({
  controllers: [ForecastingEngineController],
  providers: [ForecastingEngineService],
})
export class ForecastingEngineModule {}
