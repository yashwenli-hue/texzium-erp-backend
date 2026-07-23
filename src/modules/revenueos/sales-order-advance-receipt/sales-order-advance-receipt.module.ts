import { Module } from '@nestjs/common';
import { SalesOrderAdvanceReceiptController } from './sales-order-advance-receipt.controller';
import { SalesOrderAdvanceReceiptService } from './sales-order-advance-receipt.service';
import { DatabaseModule } from '../../../core/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [SalesOrderAdvanceReceiptController],
  providers: [SalesOrderAdvanceReceiptService],
})
export class SalesOrderAdvanceReceiptModule {}
