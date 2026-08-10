import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';

import { InventoryEngineController } from './inventory-engine.controller';
import { InventoryEngineService } from './inventory-engine.service';

import { ReserveService } from './services/reserve.service';
import { PickService } from './services/pick.service';
import { PackService } from './services/pack.service';

import { IssueService } from './services/issue.service';
import { MovementService } from './services/movement.service';

import { ReceiveService } from './services/receive.service';
import { TransferService } from './services/transfer.service';

import { AdjustmentService } from './services/adjustment.service';

import { ReleaseService } from './services/release.service';

@Module({
  imports: [DatabaseModule],

  controllers: [InventoryEngineController],

  providers: [
    InventoryEngineService,
    ReserveService,
    IssueService,
    PickService,
    PackService,
    MovementService,
    ReceiveService,
    TransferService,
    AdjustmentService,
    ReleaseService,
  ],

  exports: [
    InventoryEngineService,
    ReserveService,
    IssueService,
    PickService,
    PackService,
    MovementService,
    ReceiveService,
    TransferService,
    AdjustmentService,
    ReleaseService,  
],
})
export class InventoryEngineModule {}
