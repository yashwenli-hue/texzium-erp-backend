import { Module } from '@nestjs/common';
import { SpareConsumptionController } from './spare-consumption.controller';
import { SpareConsumptionService } from './spare-consumption.service';

@Module({
  controllers: [SpareConsumptionController],
  providers: [SpareConsumptionService],
})
export class SpareConsumptionModule {}
