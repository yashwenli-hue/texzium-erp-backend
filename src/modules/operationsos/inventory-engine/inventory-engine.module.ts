import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';

import { InventoryEngineController } from './inventory-engine.controller';
import { InventoryEngineService } from './inventory-engine.service';

import { ReserveService } from './services/reserve.service';
import { PickService } from './services/pick.service';
import { PackService } from './services/pack.service';

@Module({
  imports: [DatabaseModule],

  controllers: [InventoryEngineController],

  providers: [
    InventoryEngineService,
    ReserveService,
    PickService,
    PackService,
  ],

  exports: [
    InventoryEngineService,
    ReserveService,
    PickService,
    PackService,
  ],
})
export class InventoryEngineModule {}
