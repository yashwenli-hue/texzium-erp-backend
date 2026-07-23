import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../core/database/database.module';
import { InventoryTransactionsController } from './inventory-transactions.controller';
import { InventoryTransactionsService } from './inventory-transactions.service';

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryTransactionsController],
  providers: [InventoryTransactionsService],
})
export class InventoryTransactionsModule {}
