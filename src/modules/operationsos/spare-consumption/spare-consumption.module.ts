import { Module } from '@nestjs/common';
import { InventoryEngineModule } from '../inventory-engine/inventory-engine.module';
import { SpareConsumptionController } from './spare-consumption.controller';
import { SpareConsumptionService } from './spare-consumption.service';

@Module({
  imports: [InventoryEngineModule],
  controllers: [SpareConsumptionController],
  providers: [SpareConsumptionService],
})
export class SpareConsumptionModule {}
