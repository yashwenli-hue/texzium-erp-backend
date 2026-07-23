import { Module } from '@nestjs/common';
import { WarehousePutawaysController } from './warehouse-putaways.controller';
import { WarehousePutawaysService } from './warehouse-putaways.service';

@Module({
  controllers: [WarehousePutawaysController],
  providers: [WarehousePutawaysService],
})
export class WarehousePutawaysModule {}
