import { Module } from '@nestjs/common';
import { QcClearancesController } from './qc-clearances.controller';
import { QcClearancesService } from './qc-clearances.service';

@Module({
  controllers: [QcClearancesController],
  providers: [QcClearancesService],
})
export class QcClearancesModule {}
