import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { DispatchOrderItemsController } from './dispatch-order-items.controller';
import { DispatchOrderItemsService } from './dispatch-order-items.service';

@Module({
  imports: [DatabaseModule],
  controllers: [DispatchOrderItemsController],
  providers: [DispatchOrderItemsService],
})
export class DispatchOrderItemsModule {}
