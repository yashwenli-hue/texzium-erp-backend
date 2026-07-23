import { Module } from '@nestjs/common';
import { StockInspectionsController } from './stock-inspections.controller';
import { StockInspectionsService } from './stock-inspections.service';

@Module({
  controllers: [StockInspectionsController],
  providers: [StockInspectionsService],
})
export class StockInspectionsModule {}
