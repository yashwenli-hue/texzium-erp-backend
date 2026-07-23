import { Module } from '@nestjs/common';
import { CollectionsDashboardController } from './collections-dashboard.controller';
import { CollectionsDashboardService } from './collections-dashboard.service';

@Module({
  controllers: [CollectionsDashboardController],
  providers: [CollectionsDashboardService],
})
export class CollectionsDashboardModule {}
