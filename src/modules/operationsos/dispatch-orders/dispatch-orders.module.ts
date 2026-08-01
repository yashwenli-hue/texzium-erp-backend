import { Module } from '@nestjs/common';
import { DispatchOrdersController } from './dispatch-orders.controller';
import { DispatchOrdersService } from './dispatch-orders.service';
import { InventoryEngineModule } from '../inventory-engine/inventory-engine.module';

@Module({
  controllers: [DispatchOrdersController],
  imports: [InventoryEngineModule,],
  providers: [DispatchOrdersService],
})
export class DispatchOrdersModule {}
